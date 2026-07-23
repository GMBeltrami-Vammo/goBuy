-- Let admins use the "Delegar aprovação (Ausência)" flow too. It behaves exactly
-- like a head's delegation (same UI, records a charge_delegations row), BUT an
-- admin holds no explicit cost_center_heads rows, so finance.is_delegate_of() /
-- finance.delegated_center_ids() — which join the delegator to cost_center_heads
-- — grant the substitute ZERO cost centers. The delegation is therefore visually
-- indistinguishable but transfers nothing. Only change here: the caller may be a
-- head OR an admin (was head-only). Everything else is unchanged from 000009.

create or replace function finance.assign_charge_delegate(
  p_delegate_email text, p_starts_on date, p_ends_on date
) returns bigint language plpgsql security definer set search_path to ''
as $function$
declare
  v_email    text := finance.jwt_email();
  v_delegate text := lower(btrim(coalesce(p_delegate_email, '')));
  v_today    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id       bigint;
begin
  if not finance.is_vammo_user() then raise exception 'not authorized'; end if;
  if finance.is_rh_viewer() then raise exception 'not authorized'; end if;
  if v_delegate = '' or v_delegate not like '%@vammo.com' then
    raise exception 'o substituto precisa ser um e-mail @vammo.com';
  end if;
  if v_delegate = v_email then raise exception 'não é possível delegar para você mesmo'; end if;
  if p_starts_on is null or p_ends_on is null then raise exception 'informe a data de início e de fim'; end if;
  if p_ends_on < p_starts_on then raise exception 'a data final deve ser igual ou posterior à inicial'; end if;
  if p_ends_on < v_today then raise exception 'a janela informada já terminou'; end if;
  -- A head hands off their own CCs; an admin may also delegate (hands off nothing).
  if not (
    finance.has_role('admin'::finance.app_role)
    or exists (
      select 1 from finance.cost_center_heads h
      join finance.cost_centers c on c.id = h.cost_center_id and c.active
      where lower(h.head_email) = v_email
    )
  ) then
    raise exception 'apenas um head de centro de custo pode delegar';
  end if;
  insert into finance.charge_delegations (delegator_email, delegate_email, starts_on, ends_on, created_by_email)
  values (v_email, v_delegate, p_starts_on, p_ends_on, v_email)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function finance.assign_charge_delegate(text, date, date) from public, anon;
grant execute on function finance.assign_charge_delegate(text, date, date) to authenticated;
