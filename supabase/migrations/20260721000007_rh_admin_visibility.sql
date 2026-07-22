-- Widen confidential RH access to the admin role: RH charges are now visible to
-- the RH approver (gabriela@vammo.com) OR anyone with the admin role — still not
-- heads, finance, fiscal, or reclassifiers. Admins may also decide RH charges.

DROP POLICY IF EXISTS incoming_charges_select ON finance.incoming_charges;
CREATE POLICY incoming_charges_select ON finance.incoming_charges
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      CASE
        WHEN sheet_name = 'RH' THEN
          finance.is_rh_viewer() OR finance.has_role('admin'::finance.app_role)
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
