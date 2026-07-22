-- Confidential RH charges: a charge whose source sheet is "RH" is visible ONLY
-- to the RH approver (gabriela@vammo.com) — not the CC head, finance, admin, or
-- reclassifiers. gabriela sees only RH charges (across all CCs) and decides them.
-- RH charges are never reclassifiable. (Write-back routes to the RH webhook in
-- app code.)

-- The RH approver. Centralized so it's a one-line change if it ever moves.
CREATE OR REPLACE FUNCTION finance.is_rh_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT lower(finance.jwt_email()) = 'gabriela@vammo.com';
$function$;

REVOKE ALL ON FUNCTION finance.is_rh_viewer() FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.is_rh_viewer() TO authenticated;

-- SELECT: RH charges → RH approver only; everything else → the normal scope
-- (head / finance / fiscal / admin / reclassifier-in-reclassification). The CASE
-- guarantees non-RH viewers can never see an RH charge, and the RH approver sees
-- only RH charges.
DROP POLICY IF EXISTS incoming_charges_select ON finance.incoming_charges;
CREATE POLICY incoming_charges_select ON finance.incoming_charges
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      CASE
        WHEN sheet_name = 'RH' THEN finance.is_rh_viewer()
        ELSE (
          finance.is_head_of(cost_center_id)
          OR finance.has_role('finance'::finance.app_role)
          OR finance.has_role('fiscal'::finance.app_role)
          OR finance.has_role('admin'::finance.app_role)
          OR (status = 'reclassifying' AND finance.has_role('reclassifier'::finance.app_role))
        )
      END
    )
  );

-- Decide: RH charges are decided only by the RH approver; others by the CC head
-- (or admin), as before.
CREATE OR REPLACE FUNCTION finance.decide_incoming_charge(
  p_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email  text := finance.jwt_email();
  v_charge finance.incoming_charges%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not finance.is_vammo_user() then
    raise exception 'not authorized';
  end if;
  if p_action not in ('approve', 'deny') then
    raise exception 'invalid action';
  end if;

  select * into v_charge from finance.incoming_charges where id = p_id for update;
  if not found then
    raise exception 'charge not found';
  end if;
  if v_charge.status <> 'pending' then
    raise exception 'only pending charges can be decided';
  end if;

  if v_charge.sheet_name = 'RH' then
    if not finance.is_rh_viewer() then
      raise exception 'confidential charge — not authorized';
    end if;
  elsif not (finance.is_head_of(v_charge.cost_center_id) or finance.has_role('admin'::finance.app_role)) then
    raise exception 'only the cost center head can decide';
  end if;

  if p_action = 'deny' and v_reason is null then
    raise exception 'a reason is required to deny';
  end if;
  if length(coalesce(v_reason, '')) > 2000 then
    raise exception 'reason too long';
  end if;

  update finance.incoming_charges set
    status           = case when p_action = 'approve' then 'approved' else 'denied' end,
    decided_at       = now(),
    decided_by_email = v_email,
    decision_reason  = v_reason
  where id = p_id;
end;
$function$;

-- Reclassification never applies to confidential RH charges (would expose them
-- to reclassifiers). Block at the source RPC.
CREATE OR REPLACE FUNCTION finance.request_charge_reclassification(
  p_id uuid,
  p_proposed_cc_id bigint DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email  text := finance.jwt_email();
  v_charge finance.incoming_charges%rowtype;
begin
  if not finance.is_vammo_user() then
    raise exception 'not authorized';
  end if;

  select * into v_charge from finance.incoming_charges where id = p_id for update;
  if not found then
    raise exception 'charge not found';
  end if;
  if v_charge.status <> 'pending' then
    raise exception 'only pending charges can be reclassified';
  end if;
  if v_charge.sheet_name = 'RH' then
    raise exception 'confidential charge cannot be reclassified';
  end if;
  if v_charge.is_rateio then
    raise exception 'rateio charges cannot be reclassified';
  end if;
  if not (finance.is_head_of(v_charge.cost_center_id) or finance.has_role('admin'::finance.app_role)) then
    raise exception 'only the cost center head can request reclassification';
  end if;
  if p_proposed_cc_id is not null and not exists (
    select 1 from finance.cost_centers where id = p_proposed_cc_id and active
  ) then
    raise exception 'proposed cost center invalid or inactive';
  end if;

  update finance.incoming_charges set
    status                  = 'reclassifying',
    original_cost_center_id = coalesce(original_cost_center_id, cost_center_id),
    reclass_requested_by    = v_email,
    reclass_requested_at    = now(),
    reclass_proposed_cc_id  = p_proposed_cc_id
  where id = p_id;
end;
$function$;
