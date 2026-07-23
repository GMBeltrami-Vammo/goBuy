-- Férias / temporary delegation: a cost-center head appoints a substitute (any
-- @vammo.com email) to answer their charges for a bounded date window. Access is
-- granted purely by an RLS date check, so it EXPIRES AUTOMATICALLY when the
-- window passes — no cron. A delegation covers ALL cost centers the delegator
-- heads (it follows the delegator's CCs at query time). RH charges are never
-- delegated (heads don't see them).
--
-- This migration also redefines the incoming_charges SELECT policy and the
-- decide / reclassification RPCs in their FINAL form — RH-admin visibility
-- (migrations 000007/000008) plus the new delegate grant — so applying it also
-- brings those objects to the intended state.

-- ── Table ─────────────────────────────────────────────────────────────────────
create table if not exists finance.charge_delegations (
  id               bigint generated always as identity primary key,
  delegator_email  text        not null,
  delegate_email   text        not null,
  starts_on        date        not null,
  ends_on          date        not null,
  created_by_email text        not null,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  constraint charge_delegations_window_ck   check (ends_on >= starts_on),
  constraint charge_delegations_distinct_ck check (lower(delegate_email) <> lower(delegator_email))
);
create index if not exists charge_delegations_delegate_idx
  on finance.charge_delegations (delegate_email) where revoked_at is null;
create index if not exists charge_delegations_delegator_idx
  on finance.charge_delegations (delegator_email) where revoked_at is null;

alter table finance.charge_delegations enable row level security;
grant select on finance.charge_delegations to authenticated;

-- A user may read delegations they created, ones naming them as substitute, and
-- admins see all. No direct writes — creation/cancellation go through the RPCs.
drop policy if exists charge_delegations_select on finance.charge_delegations;
create policy charge_delegations_select on finance.charge_delegations
  for select using (
    finance.is_vammo_user() and (
      finance.jwt_email() = lower(delegator_email)
      or finance.jwt_email() = lower(delegate_email)
      or finance.has_role('admin'::finance.app_role)
    )
  );

-- ── Helpers ───────────────────────────────────────────────────────────────────
-- Is the CURRENT user an active substitute for this cost center right now?
-- (some head of the CC has a live, non-revoked delegation to the caller today).
create or replace function finance.is_delegate_of(p_cost_center_id bigint)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from finance.charge_delegations d
    join finance.cost_center_heads h on lower(h.head_email) = lower(d.delegator_email)
    where lower(d.delegate_email) = finance.jwt_email()
      and d.revoked_at is null
      and (now() at time zone 'America/Sao_Paulo')::date between d.starts_on and d.ends_on
      and h.cost_center_id = p_cost_center_id
  );
$$;
revoke all on function finance.is_delegate_of(bigint) from public, anon;
grant execute on function finance.is_delegate_of(bigint) to authenticated;

-- Active-delegation cost centers for an email — used server-side (service role)
-- to compute the substitute's effective head centers for the session.
create or replace function finance.delegated_center_ids(p_email text)
 returns table (cost_center_id bigint) language sql stable security definer set search_path to ''
as $$
  select distinct h.cost_center_id
  from finance.charge_delegations d
  join finance.cost_center_heads h on lower(h.head_email) = lower(d.delegator_email)
  join finance.cost_centers c on c.id = h.cost_center_id and c.active
  where lower(d.delegate_email) = lower(p_email)
    and d.revoked_at is null
    and (now() at time zone 'America/Sao_Paulo')::date between d.starts_on and d.ends_on;
$$;
revoke all on function finance.delegated_center_ids(text) from public, anon;
grant execute on function finance.delegated_center_ids(text) to authenticated, service_role;

-- ── Charges SELECT policy (final form: RH-admin + delegate) ────────────────────
drop policy if exists incoming_charges_select on finance.incoming_charges;
create policy incoming_charges_select on finance.incoming_charges
  for select using (
    finance.is_vammo_user() and (
      case
        when sheet_name = 'RH' then
          finance.is_rh_viewer() or finance.has_role('admin'::finance.app_role)
        else (
          not finance.is_rh_viewer() and (
            finance.is_head_of(cost_center_id)
            or finance.is_delegate_of(cost_center_id)
            or finance.has_role('finance'::finance.app_role)
            or finance.has_role('fiscal'::finance.app_role)
            or finance.has_role('admin'::finance.app_role)
            or (status = 'reclassifying' and finance.has_role('reclassifier'::finance.app_role))
          )
        )
      end
    )
  );

-- Budgets follow the same "acts as head" rule so a substitute sees the budget of
-- the delegated cost centers.
drop policy if exists cost_center_budgets_select on finance.cost_center_budgets;
create policy cost_center_budgets_select on finance.cost_center_budgets
  for select using (
    finance.is_vammo_user() and (
      finance.is_head_of(cost_center_id)
      or finance.is_delegate_of(cost_center_id)
      or finance.has_role('finance'::finance.app_role)
      or finance.has_role('fiscal'::finance.app_role)
      or finance.has_role('admin'::finance.app_role)
    )
  );

-- ── decide RPC (final form: RH-admin + delegate may decide) ────────────────────
create or replace function finance.decide_incoming_charge(
  p_id uuid, p_action text, p_reason text default null
) returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_email  text := finance.jwt_email();
  v_charge finance.incoming_charges%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not finance.is_vammo_user() then raise exception 'not authorized'; end if;
  if p_action not in ('approve', 'deny') then raise exception 'invalid action'; end if;
  select * into v_charge from finance.incoming_charges where id = p_id for update;
  if not found then raise exception 'charge not found'; end if;
  if v_charge.status <> 'pending' then raise exception 'only pending charges can be decided'; end if;
  if v_charge.sheet_name = 'RH' then
    if not (finance.is_rh_viewer() or finance.has_role('admin'::finance.app_role)) then
      raise exception 'confidential charge — not authorized';
    end if;
  else
    if finance.is_rh_viewer()
       or not (
         finance.is_head_of(v_charge.cost_center_id)
         or finance.is_delegate_of(v_charge.cost_center_id)
         or finance.has_role('admin'::finance.app_role)
       ) then
      raise exception 'only the cost center head can decide';
    end if;
  end if;
  if p_action = 'deny' and v_reason is null then raise exception 'a reason is required to deny'; end if;
  if length(coalesce(v_reason, '')) > 2000 then raise exception 'reason too long'; end if;
  update finance.incoming_charges set
    status           = case when p_action = 'approve' then 'approved' else 'denied' end,
    decided_at       = now(),
    decided_by_email = v_email,
    decision_reason  = v_reason
  where id = p_id;
end;
$function$;

-- ── reclassification request RPC (final form: delegate may request) ────────────
create or replace function finance.request_charge_reclassification(
  p_id uuid, p_proposed_cc_id bigint default null
) returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_email  text := finance.jwt_email();
  v_charge finance.incoming_charges%rowtype;
begin
  if not finance.is_vammo_user() then raise exception 'not authorized'; end if;
  select * into v_charge from finance.incoming_charges where id = p_id for update;
  if not found then raise exception 'charge not found'; end if;
  if v_charge.status <> 'pending' then raise exception 'only pending charges can be reclassified'; end if;
  if v_charge.sheet_name = 'RH' then raise exception 'confidential charge cannot be reclassified'; end if;
  if v_charge.is_rateio then raise exception 'rateio charges cannot be reclassified'; end if;
  if finance.is_rh_viewer()
     or not (
       finance.is_head_of(v_charge.cost_center_id)
       or finance.is_delegate_of(v_charge.cost_center_id)
       or finance.has_role('admin'::finance.app_role)
     ) then
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

-- ── Delegation write RPCs ──────────────────────────────────────────────────────
-- A head appoints a substitute for a date window. The caller delegates their own
-- head role (delegator = the caller). Any @vammo.com email may be the substitute.
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
  -- The caller must actually head at least one active cost center (that is what
  -- gets delegated). Pure admins with no CCs have nothing to hand over.
  if not exists (
    select 1 from finance.cost_center_heads h
    join finance.cost_centers c on c.id = h.cost_center_id and c.active
    where lower(h.head_email) = v_email
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

-- Cancel a delegation early (the substitute loses access immediately). Only the
-- head who created it, or an admin, may cancel.
create or replace function finance.revoke_charge_delegate(p_id bigint)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_email text := finance.jwt_email();
  v_row   finance.charge_delegations%rowtype;
begin
  if not finance.is_vammo_user() then raise exception 'not authorized'; end if;
  select * into v_row from finance.charge_delegations where id = p_id for update;
  if not found then raise exception 'delegation not found'; end if;
  if not (v_email = lower(v_row.delegator_email) or finance.has_role('admin'::finance.app_role)) then
    raise exception 'apenas quem criou a delegação pode cancelá-la';
  end if;
  update finance.charge_delegations set revoked_at = now() where id = p_id and revoked_at is null;
end;
$function$;
revoke all on function finance.revoke_charge_delegate(bigint) from public, anon;
grant execute on function finance.revoke_charge_delegate(bigint) to authenticated;
