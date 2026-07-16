-- Incoming-charges demo: charges (POs/ROs) arrive from an external system via
-- the /api/charges inbound API, and each cost-center head approves or denies
-- the charges for their own CCs. Isolated from purchase_requests — its own
-- table, status set, RLS, and decide RPC. Modeled on approve_purchase_request
-- (20260701000001) and reusing finance.is_vammo_user()/has_role()/is_head_of().

-- Display id: CH-0001, CH-0002, … (mirrors next_request_display_id()).
CREATE SEQUENCE IF NOT EXISTS finance.incoming_charge_display_seq;

-- The inbound API inserts as the service role, and next_charge_display_id()
-- (SECURITY INVOKER) runs nextval() as that caller — so the service role needs
-- USAGE on the sequence, or every insert 403s on the display_id default. The
-- pre-existing purchase_request_display_seq already grants this; new sequences
-- in the finance schema don't inherit it, so grant it explicitly.
GRANT USAGE, SELECT ON SEQUENCE finance.incoming_charge_display_seq TO service_role;

CREATE OR REPLACE FUNCTION finance.next_charge_display_id()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  n bigint;
begin
  n := nextval('finance.incoming_charge_display_seq');
  return 'CH-' || lpad(n::text, greatest(4, length(n::text)), '0');
end;
$function$;

CREATE TABLE IF NOT EXISTS finance.incoming_charges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id        text UNIQUE NOT NULL DEFAULT finance.next_charge_display_id(),
  supplier_name     text NOT NULL,
  nf_number         text,
  description       text,
  cost_center_id    bigint NOT NULL REFERENCES finance.cost_centers(id),
  cost_center_input text,                                   -- raw code/class string the sender sent (audit)
  due_date          date,
  attachment_url    text,                                   -- NF/receipt link
  boleto_url        text,                                   -- boleto link
  email             text,
  payment_method    text,
  pix_key           text,
  amount            numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency          text NOT NULL DEFAULT 'BRL',            -- ISO code (BRL, USD, CNY, MXN, COP…)
  observation       text,
  sheet_name        text,                                   -- Google-Sheets write-back tab
  sheet_row         integer,                                -- Google-Sheets write-back row
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  decided_by_email  text,
  decision_reason   text,
  sheet_written_at  timestamptz,                            -- stamped when TRUE is written back (deferred)
  -- Dedup on the source spreadsheet row: a re-sent row is skipped. The inbound
  -- API upserts ON CONFLICT DO NOTHING and still returns success so the sender
  -- doesn't retry. (NULLS DISTINCT — rows without a source row are not deduped.)
  CONSTRAINT incoming_charges_sheet_row_key UNIQUE (sheet_name, sheet_row)
);

CREATE INDEX IF NOT EXISTS incoming_charges_cost_center_id_idx ON finance.incoming_charges (cost_center_id);
CREATE INDEX IF NOT EXISTS incoming_charges_status_idx ON finance.incoming_charges (status);

ALTER TABLE finance.incoming_charges ENABLE ROW LEVEL SECURITY;

-- SELECT only, scoped like purchase_requests: a head sees their CCs' charges;
-- finance/fiscal/admin see all. No INSERT/UPDATE/DELETE grants — writes happen
-- only via the service role (inbound API) or the decide RPC below.
DROP POLICY IF EXISTS incoming_charges_select ON finance.incoming_charges;
CREATE POLICY incoming_charges_select ON finance.incoming_charges
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      finance.is_head_of(cost_center_id)
      OR finance.has_role('finance'::finance.app_role)
      OR finance.has_role('fiscal'::finance.app_role)
      OR finance.has_role('admin'::finance.app_role)
    )
  );

GRANT SELECT ON finance.incoming_charges TO authenticated;

-- Head (or admin) approves/denies a pending charge. FOR UPDATE row lock;
-- caller must head the charge's cost center or be an admin; deny needs a reason.
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
  if not (finance.is_head_of(v_charge.cost_center_id) or finance.has_role('admin'::finance.app_role)) then
    raise exception 'only the cost center head can decide';
  end if;
  if p_action = 'deny' and v_reason is null then
    raise exception 'a reason is required to deny';
  end if;
  if length(coalesce(v_reason, '')) > 2000 then
    raise exception 'reason too long';
  end if;

  update finance.incoming_charges set
    status          = case when p_action = 'approve' then 'approved' else 'denied' end,
    decided_at      = now(),
    decided_by_email = v_email,
    decision_reason = v_reason
  where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION finance.decide_incoming_charge(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.decide_incoming_charge(uuid, text, text) TO authenticated;
