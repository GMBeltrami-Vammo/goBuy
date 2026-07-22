-- Harden the RH confidentiality boundary (per adversarial review):
-- the RH approver (is_rh_viewer) must see/decide/act on ONLY RH charges — never
-- non-RH charges, even for cost centers they happen to head (gabriela is seeded
-- as head of the HR CCs 1801-1804/2409). Achieved by gating every NON-RH path
-- with `NOT finance.is_rh_viewer()`. The RH branch (is_rh_viewer OR admin) is
-- unchanged.

DROP POLICY IF EXISTS incoming_charges_select ON finance.incoming_charges;
CREATE POLICY incoming_charges_select ON finance.incoming_charges
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      CASE
        WHEN sheet_name = 'RH' THEN
          finance.is_rh_viewer() OR finance.has_role('admin'::finance.app_role)
        ELSE (
          NOT finance.is_rh_viewer() AND (
            finance.is_head_of(cost_center_id)
            OR finance.has_role('finance'::finance.app_role)
            OR finance.has_role('fiscal'::finance.app_role)
            OR finance.has_role('admin'::finance.app_role)
            OR (status = 'reclassifying' AND finance.has_role('reclassifier'::finance.app_role))
          )
        )
      END
    )
  );

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
    if not (finance.is_rh_viewer() or finance.has_role('admin'::finance.app_role)) then
      raise exception 'confidential charge — not authorized';
    end if;
  else
    -- Non-RH: the RH approver must never decide these, even for CCs they head.
    if finance.is_rh_viewer()
       or not (finance.is_head_of(v_charge.cost_center_id) or finance.has_role('admin'::finance.app_role)) then
      raise exception 'only the cost center head can decide';
    end if;
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

-- Reclassification is a head action on non-RH charges; the RH approver never
-- performs it (RH charges are already non-reclassifiable).
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
  if finance.is_rh_viewer()
     or not (finance.is_head_of(v_charge.cost_center_id) or finance.has_role('admin'::finance.app_role)) then
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
