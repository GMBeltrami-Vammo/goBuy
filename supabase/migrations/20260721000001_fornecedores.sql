-- Fornecedores (suppliers) registry: anyone in the full app registers a supplier,
-- Finance approves it (logged), and every purchase request must reference an
-- approved, active fornecedor (enforced in Migration B). This gives clean master
-- data and reusable bank/contract details. Modeled on incoming_charges
-- (20260716000001) and the finance/admin gate idiom (20260701000002), reusing
-- finance.is_vammo_user()/has_role()/jwt_email().

CREATE TABLE IF NOT EXISTS finance.fornecedores (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- registration sequence
  razao_social          text NOT NULL,
  document              text NOT NULL,                        -- CNPJ (validated via BrasilAPI at registration)
  -- Bank-transfer method (all three together) OR PIX method — at least one required.
  banco                 text,
  agencia               text,
  conta                 text,
  pix_key               text,
  payment_default       text CHECK (payment_default IN ('bank', 'pix')),  -- which wins when both present
  default_cost_center_id bigint REFERENCES finance.cost_centers(id),      -- optional manual default CC
  -- Contract / proposta PDF (optional, single, replaceable).
  contract_storage_path text,
  contract_filename     text,
  contract_content_type text,
  contract_size_bytes   bigint,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  active                boolean NOT NULL DEFAULT true,
  created_by_email      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  approved_by_email     text,
  approved_at           timestamptz,
  -- At least one payment method must be present.
  CONSTRAINT fornecedores_payment_method_chk CHECK (
    (banco IS NOT NULL AND agencia IS NOT NULL AND conta IS NOT NULL)
    OR pix_key IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS fornecedores_status_idx ON finance.fornecedores (status);
CREATE INDEX IF NOT EXISTS fornecedores_status_active_idx ON finance.fornecedores (status, active);

ALTER TABLE finance.fornecedores ENABLE ROW LEVEL SECURITY;

-- SELECT: everyone (vammo user) sees approved+active suppliers so they can pick
-- one when creating a request; finance/admin see all (to approve/manage); a
-- registrant sees their own still-pending submission. No write grants — writes
-- happen only via the SECURITY DEFINER RPCs below or the contract-upload route.
DROP POLICY IF EXISTS fornecedores_select ON finance.fornecedores;
CREATE POLICY fornecedores_select ON finance.fornecedores
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      (status = 'approved' AND active)
      OR finance.has_role('finance'::finance.app_role)
      OR finance.has_role('admin'::finance.app_role)
      OR created_by_email = finance.jwt_email()
    )
  );

GRANT SELECT ON finance.fornecedores TO authenticated;

-- Audit log for the supplier lifecycle (mirrors finance.request_events).
CREATE TABLE IF NOT EXISTS finance.fornecedor_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fornecedor_id bigint NOT NULL REFERENCES finance.fornecedores(id) ON DELETE CASCADE,
  event_type    text NOT NULL,                 -- registered | approved | removed | reactivated | contract_added
  actor_email   text,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fornecedor_events_fornecedor_id_idx
  ON finance.fornecedor_events (fornecedor_id);

ALTER TABLE finance.fornecedor_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fornecedor_events_select ON finance.fornecedor_events;
CREATE POLICY fornecedor_events_select ON finance.fornecedor_events
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      finance.has_role('finance'::finance.app_role)
      OR finance.has_role('admin'::finance.app_role)
    )
  );

GRANT SELECT ON finance.fornecedor_events TO authenticated;

-- ── register_fornecedor ──────────────────────────────────────────────────────
-- Any vammo user registers a supplier as 'pending'. Validates the payment method
-- (at least one; a default is required only when both are supplied). The contract
-- PDF is uploaded afterward via the /api/fornecedores/[id]/contract route.
CREATE OR REPLACE FUNCTION finance.register_fornecedor(p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email   text := finance.jwt_email();
  v_razao   text := nullif(btrim(p_payload ->> 'razao_social'), '');
  v_doc     text := nullif(btrim(p_payload ->> 'document'), '');
  v_banco   text := nullif(btrim(p_payload ->> 'banco'), '');
  v_agencia text := nullif(btrim(p_payload ->> 'agencia'), '');
  v_conta   text := nullif(btrim(p_payload ->> 'conta'), '');
  v_pix     text := nullif(btrim(p_payload ->> 'pix_key'), '');
  v_default text := nullif(btrim(p_payload ->> 'payment_default'), '');
  v_cc_id   bigint := nullif(p_payload ->> 'default_cost_center_id', '')::bigint;
  v_has_bank boolean;
  v_has_pix  boolean;
  v_id      bigint;
begin
  if not finance.is_vammo_user() then
    raise exception 'not authorized';
  end if;
  if v_razao is null then
    raise exception 'razão social é obrigatória';
  end if;
  if length(v_razao) > 200 then
    raise exception 'razão social muito longa';
  end if;
  if v_doc is null then
    raise exception 'CNPJ é obrigatório';
  end if;
  if length(v_doc) > 40 then
    raise exception 'CNPJ inválido';
  end if;

  v_has_bank := (v_banco is not null and v_agencia is not null and v_conta is not null);
  v_has_pix  := (v_pix is not null);
  if not v_has_bank and not v_has_pix then
    raise exception 'informe ao menos um método de pagamento (banco completo ou chave PIX)';
  end if;

  -- Resolve the default method: required only when both are present.
  if v_has_bank and v_has_pix then
    if v_default not in ('bank', 'pix') then
      raise exception 'informe o método de pagamento padrão';
    end if;
  elsif v_has_bank then
    v_default := 'bank';
  else
    v_default := 'pix';
  end if;

  if v_cc_id is not null and not exists (
    select 1 from finance.cost_centers where id = v_cc_id and active
  ) then
    raise exception 'centro de custo padrão inválido ou inativo';
  end if;

  insert into finance.fornecedores (
    razao_social, document, banco, agencia, conta, pix_key,
    payment_default, default_cost_center_id, status, created_by_email
  ) values (
    v_razao, v_doc,
    case when v_has_bank then v_banco end,
    case when v_has_bank then v_agencia end,
    case when v_has_bank then v_conta end,
    case when v_has_pix then v_pix end,
    v_default, v_cc_id, 'pending', v_email
  )
  returning id into v_id;

  insert into finance.fornecedor_events (fornecedor_id, event_type, actor_email, detail)
  values (v_id, 'registered', v_email,
          jsonb_build_object('razao_social', v_razao, 'document', v_doc));

  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION finance.register_fornecedor(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.register_fornecedor(jsonb) TO authenticated;

-- ── approve_fornecedor ───────────────────────────────────────────────────────
-- Finance/admin approves a pending supplier. Row-locked; idempotency guarded by
-- the pending check.
CREATE OR REPLACE FUNCTION finance.approve_fornecedor(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := finance.jwt_email();
  v_forn  finance.fornecedores%rowtype;
begin
  if not finance.is_vammo_user()
     or not (finance.has_role('finance'::finance.app_role)
             or finance.has_role('admin'::finance.app_role)) then
    raise exception 'not authorized';
  end if;

  select * into v_forn from finance.fornecedores where id = p_id for update;
  if not found then
    raise exception 'fornecedor não encontrado';
  end if;
  if v_forn.status <> 'pending' then
    raise exception 'apenas fornecedores pendentes podem ser aprovados';
  end if;

  update finance.fornecedores
     set status = 'approved', approved_by_email = v_email, approved_at = now()
   where id = p_id;

  insert into finance.fornecedor_events (fornecedor_id, event_type, actor_email)
  values (p_id, 'approved', v_email);
end;
$function$;

REVOKE ALL ON FUNCTION finance.approve_fornecedor(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.approve_fornecedor(bigint) TO authenticated;

-- ── remove_fornecedor ────────────────────────────────────────────────────────
-- Finance/admin removes a supplier. A still-pending one was never referenced, so
-- it is hard-deleted (its events cascade away). An approved one may be referenced
-- by past requests, so it is soft-deleted (active=false) and the removal logged.
CREATE OR REPLACE FUNCTION finance.remove_fornecedor(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := finance.jwt_email();
  v_forn  finance.fornecedores%rowtype;
begin
  if not finance.is_vammo_user()
     or not (finance.has_role('finance'::finance.app_role)
             or finance.has_role('admin'::finance.app_role)) then
    raise exception 'not authorized';
  end if;

  select * into v_forn from finance.fornecedores where id = p_id for update;
  if not found then
    raise exception 'fornecedor não encontrado';
  end if;

  if v_forn.status = 'pending' then
    delete from finance.fornecedores where id = p_id;   -- never referenced; events cascade
  else
    update finance.fornecedores set active = false where id = p_id;
    insert into finance.fornecedor_events (fornecedor_id, event_type, actor_email)
    values (p_id, 'removed', v_email);
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION finance.remove_fornecedor(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.remove_fornecedor(bigint) TO authenticated;
