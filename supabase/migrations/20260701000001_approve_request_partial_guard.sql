-- P1-11: double-submit guard for approvals.
--
-- Before: a head re-clicking "Aprovar" on a multi-department request whose other
-- allocations were still pending would insert a second `partial_approval` event
-- even though their own allocation was already approved (the UPDATE matched 0
-- rows). This adds a ROW_COUNT check so the event is only written when this call
-- actually approved an allocation, and raises a clear error on a no-op re-click.
--
-- Single-allocation double-clicks were already handled: the first click flips the
-- request to `approved`, and the second is caught by the `status <> 'pending'`
-- guard under the FOR UPDATE row lock.

CREATE OR REPLACE FUNCTION finance.approve_purchase_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance'
AS $function$
DECLARE
  v_email         text := finance.jwt_email();
  v_req           finance.purchase_requests%rowtype;
  v_total_allocs  integer;
  v_pending_left  integer;
  v_just_approved integer;
BEGIN
  IF NOT finance.is_vammo_user() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO v_req FROM finance.purchase_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'only pending requests can be approved';
  END IF;

  -- Caller must be head of at least one allocation CC
  IF NOT EXISTS (
    SELECT 1 FROM finance.request_allocations ra
    JOIN finance.cost_center_heads cch ON cch.cost_center_id = ra.cost_center_id
    WHERE ra.request_id = p_request_id AND cch.head_email = v_email
  ) THEN
    RAISE EXCEPTION 'only a cost center head can approve';
  END IF;

  -- Mark all allocations where caller is head and not yet approved
  UPDATE finance.request_allocations
  SET approved_at = now(), approved_by_email = v_email
  WHERE request_id = p_request_id
    AND approved_at IS NULL
    AND cost_center_id IN (
      SELECT cost_center_id FROM finance.cost_center_heads WHERE head_email = v_email
    );
  GET DIAGNOSTICS v_just_approved = ROW_COUNT;

  SELECT count(*) INTO v_total_allocs
  FROM finance.request_allocations WHERE request_id = p_request_id;

  SELECT count(*) INTO v_pending_left
  FROM finance.request_allocations WHERE request_id = p_request_id AND approved_at IS NULL;

  IF v_pending_left = 0 THEN
    -- All CCs signed off → advance to approved
    UPDATE finance.purchase_requests
    SET status = 'approved', decided_at = now(), decided_by_email = v_email
    WHERE id = p_request_id;

    INSERT INTO finance.request_events (request_id, event_type, actor_email)
    VALUES (p_request_id, 'approved', v_email);
  ELSIF v_just_approved > 0 THEN
    -- This call approved some (but not all) allocations → log a partial approval
    INSERT INTO finance.request_events (request_id, event_type, actor_email, detail)
    VALUES (p_request_id, 'partial_approval', v_email,
            jsonb_build_object('approved', v_total_allocs - v_pending_left, 'total', v_total_allocs));
  ELSE
    -- Caller heads only allocations that were already approved (e.g. a
    -- double-click). Nothing to do, and no duplicate event.
    RAISE EXCEPTION 'you have already approved your allocation for this request';
  END IF;
END;
$function$;
