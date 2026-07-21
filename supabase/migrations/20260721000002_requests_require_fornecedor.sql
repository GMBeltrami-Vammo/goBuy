-- Couple purchase requests to the fornecedores registry (Migration A). Every
-- request must reference an approved, active fornecedor; supplier_name /
-- supplier_document are snapshotted from it at submit time so export, Slack, the
-- UI and history keep working unchanged even if the supplier is later edited or
-- deactivated. Safe as NOT NULL because purchase_requests has no rows yet.

ALTER TABLE finance.purchase_requests
  ADD COLUMN IF NOT EXISTS fornecedor_id bigint REFERENCES finance.fornecedores(id);

-- Enforce the requirement (table is empty, so no backfill needed).
ALTER TABLE finance.purchase_requests
  ALTER COLUMN fornecedor_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS purchase_requests_fornecedor_id_idx
  ON finance.purchase_requests (fornecedor_id);

-- Most-used cost center for a fornecedor across its past requests — used as the
-- fallback default CC when the supplier has no manual default. SECURITY DEFINER
-- so it reflects a true org-wide most-used (bypasses the caller's request RLS).
CREATE OR REPLACE FUNCTION finance.fornecedor_top_cc(p_id bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select cost_center_id
  from finance.purchase_requests
  where fornecedor_id = p_id
  group by cost_center_id
  order by count(*) desc, max(created_at) desc
  limit 1;
$function$;

REVOKE ALL ON FUNCTION finance.fornecedor_top_cc(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.fornecedor_top_cc(bigint) TO authenticated;

-- Rebuilt from the live definition; the ONLY changes are: (1) the supplier is
-- resolved from an approved+active fornecedor instead of free text, (2) the
-- request stores fornecedor_id and snapshots supplier_name/supplier_document
-- from that fornecedor. Everything else (allocations, items, events, head
-- notification, Slack queue) is unchanged.
CREATE OR REPLACE FUNCTION finance.submit_purchase_request(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance'
AS $function$
DECLARE
  v_email        text := finance.jwt_email();
  v_type         finance.request_type;
  v_forn_id      bigint;
  v_supplier     text;
  v_supplier_doc text;
  v_cc_id        bigint;
  v_cc_name      text;
  v_department   text;
  v_total        numeric(14,2) := 0;
  v_item         jsonb;
  v_items        jsonb;
  v_pos          integer := 0;
  v_id           uuid;
  v_display      text;
  v_head         record;
  v_queued       integer := 0;
  v_currency     text;
  v_contracted   text;
  v_company      text;
  v_allocs       jsonb;
  v_alloc        jsonb;
  v_alloc_sum    numeric := 0;
  v_alloc_cc     bigint;
  v_alloc_pct    numeric;
BEGIN
  IF NOT finance.is_vammo_user() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_type    := (p_payload ->> 'request_type')::finance.request_type;
  v_forn_id := nullif(p_payload ->> 'fornecedor_id', '')::bigint;
  v_cc_id   := (p_payload ->> 'cost_center_id')::bigint;

  -- Supplier comes from an approved, active fornecedor (registry is the source
  -- of truth); snapshot its name/document onto the request.
  IF v_forn_id IS NULL THEN
    RAISE EXCEPTION 'fornecedor é obrigatório';
  END IF;
  SELECT razao_social, document INTO v_supplier, v_supplier_doc
  FROM finance.fornecedores
  WHERE id = v_forn_id AND status = 'approved' AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fornecedor inválido ou não aprovado';
  END IF;

  IF length(coalesce(p_payload ->> 'justification', '')) > 4000
     OR length(coalesce(p_payload ->> 'notes', '')) > 4000 THEN
    RAISE EXCEPTION 'text field too long';
  END IF;

  v_currency := coalesce(nullif(upper(trim(p_payload ->> 'currency')), ''), 'BRL');
  IF v_currency !~ '^[A-Z]{2,10}$' THEN
    RAISE EXCEPTION 'invalid currency code';
  END IF;

  v_contracted := nullif(trim(p_payload ->> 'contracted_company'), '');
  v_company    := nullif(trim(p_payload ->> 'company'), '');
  IF length(coalesce(v_contracted, '')) > 200 OR length(coalesce(v_company, '')) > 200 THEN
    RAISE EXCEPTION 'company field too long';
  END IF;

  SELECT name, department INTO v_cc_name, v_department
  FROM finance.cost_centers
  WHERE id = v_cc_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or inactive cost center';
  END IF;

  v_allocs := p_payload -> 'allocations';
  IF v_allocs IS NOT NULL AND jsonb_typeof(v_allocs) = 'array' AND jsonb_array_length(v_allocs) > 0 THEN
    IF jsonb_array_length(v_allocs) > 20 THEN
      RAISE EXCEPTION 'too many allocations';
    END IF;
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocs) LOOP
      v_alloc_pct := coalesce((v_alloc ->> 'percentage')::numeric, 0);
      IF v_alloc_pct <= 0 OR v_alloc_pct > 100 THEN
        RAISE EXCEPTION 'allocation percentage must be between 0 and 100';
      END IF;
      v_alloc_sum := v_alloc_sum + v_alloc_pct;
      IF NOT EXISTS (SELECT 1 FROM finance.cost_centers
                     WHERE id = (v_alloc ->> 'cost_center_id')::bigint AND active) THEN
        RAISE EXCEPTION 'invalid or inactive cost center in allocation';
      END IF;
    END LOOP;
    IF abs(v_alloc_sum - 100) > 0.01 THEN
      RAISE EXCEPTION 'allocations must sum to 100%%';
    END IF;
  ELSE
    v_allocs := null;
  END IF;

  IF v_type = 'products' THEN
    v_items := p_payload -> 'items';
    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
      RAISE EXCEPTION 'at least one item is required';
    END IF;
    IF jsonb_array_length(v_items) > 100 THEN
      RAISE EXCEPTION 'too many items';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      IF nullif(trim(v_item ->> 'description'), '') IS NULL THEN
        RAISE EXCEPTION 'item description is required';
      END IF;
      IF coalesce((v_item ->> 'quantity')::numeric, 0) <= 0
         OR coalesce((v_item ->> 'unit_value')::numeric, -1) < 0 THEN
        RAISE EXCEPTION 'invalid item quantity or value';
      END IF;
      v_total := v_total + round((v_item ->> 'quantity')::numeric * (v_item ->> 'unit_value')::numeric, 2);
    END LOOP;
  ELSE
    v_total := coalesce((p_payload ->> 'total_amount')::numeric, 0);
  END IF;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'total amount must be positive';
  END IF;
  IF v_total > 10000000 THEN
    RAISE EXCEPTION 'total amount above platform limit';
  END IF;

  INSERT INTO finance.purchase_requests (
    request_type, fornecedor_id, supplier_name, supplier_document, cost_center_id,
    requester_id, requester_email, justification, notes, total_amount,
    currency, contracted_company, company,
    service_period, service_start, service_end,
    advance_purpose, advance_use_date, advance_settlement_deadline
  ) VALUES (
    v_type, v_forn_id, v_supplier, v_supplier_doc, v_cc_id,
    auth.uid(), v_email,
    nullif(trim(p_payload ->> 'justification'), ''),
    nullif(trim(p_payload ->> 'notes'), ''),
    v_total,
    v_currency, v_contracted, v_company,
    CASE WHEN v_type = 'service' THEN nullif(trim(p_payload ->> 'service_period'), '') END,
    CASE WHEN v_type = 'service' THEN (p_payload ->> 'service_start')::date END,
    CASE WHEN v_type = 'service' THEN (p_payload ->> 'service_end')::date END,
    CASE WHEN v_type = 'advance' THEN nullif(trim(p_payload ->> 'advance_purpose'), '') END,
    CASE WHEN v_type = 'advance' THEN (p_payload ->> 'advance_use_date')::date END,
    CASE WHEN v_type = 'advance' THEN (p_payload ->> 'advance_settlement_deadline')::date END
  )
  RETURNING id, display_id INTO v_id, v_display;

  IF v_allocs IS NOT NULL THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocs) LOOP
      v_alloc_cc  := (v_alloc ->> 'cost_center_id')::bigint;
      v_alloc_pct := (v_alloc ->> 'percentage')::numeric;
      INSERT INTO finance.request_allocations (request_id, cost_center_id, percentage)
      VALUES (v_id, v_alloc_cc, v_alloc_pct)
      ON CONFLICT (request_id, cost_center_id)
      DO UPDATE SET percentage = finance.request_allocations.percentage + excluded.percentage;
    END LOOP;
  ELSE
    INSERT INTO finance.request_allocations (request_id, cost_center_id, percentage)
    VALUES (v_id, v_cc_id, 100);
  END IF;

  IF v_type = 'products' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_pos := v_pos + 1;
      INSERT INTO finance.request_items (request_id, position, description, quantity, unit, unit_value)
      VALUES (
        v_id, v_pos,
        trim(v_item ->> 'description'),
        (v_item ->> 'quantity')::numeric,
        coalesce(nullif(trim(v_item ->> 'unit'), ''), 'un'),
        (v_item ->> 'unit_value')::numeric
      );
    END LOOP;
  END IF;

  INSERT INTO finance.request_events (request_id, event_type, actor_email, detail)
  VALUES (v_id, 'created', v_email,
          jsonb_build_object('request_type', v_type, 'total_amount', v_total,
                             'cost_center_id', v_cc_id, 'fornecedor_id', v_forn_id));

  -- Notify heads of ALL allocation cost centers (distinct), not just the primary CC
  FOR v_head IN
    SELECT DISTINCT cch.head_email
    FROM finance.cost_center_heads cch
    JOIN finance.request_allocations ra ON ra.cost_center_id = cch.cost_center_id
    WHERE ra.request_id = v_id
  LOOP
    INSERT INTO finance.slack_notification_queue (request_id, recipient_email, message_payload)
    VALUES (v_id, v_head.head_email, jsonb_build_object(
      'display_id', v_display,
      'supplier_name', v_supplier,
      'total_amount', v_total,
      'currency', v_currency,
      'requester_email', v_email,
      'cost_center', v_cc_name,
      'department', v_department,
      'request_type', v_type
    ));
    v_queued := v_queued + 1;
  END LOOP;

  IF v_queued > 0 THEN
    INSERT INTO finance.request_events (request_id, event_type, actor_email, detail)
    VALUES (v_id, 'notification_queued', v_email, jsonb_build_object('recipients', v_queued));
  END IF;

  RETURN jsonb_build_object('id', v_id, 'display_id', v_display);
END;
$function$;
