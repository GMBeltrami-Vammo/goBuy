-- Charge reclassification: a head asks to move a charge to a different cost
-- center; a reclassifier (Bruna/Maria) assigns the new CC; it then goes to the
-- new CC's head to approve. Also adds request_date (from the API) and an
-- is_rateio flag (rateio charges can't be reclassified). Apply AFTER
-- 20260721000004 (which adds the 'reclassifier' enum value).

-- ── New columns ──────────────────────────────────────────────────────────────
ALTER TABLE finance.incoming_charges
  ADD COLUMN IF NOT EXISTS request_date          timestamptz,          -- data da solicitação (API)
  ADD COLUMN IF NOT EXISTS is_rateio             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reclassified_cc_code  text NOT NULL DEFAULT '',  -- new_cc for write-back ("" = never reclassified)
  ADD COLUMN IF NOT EXISTS original_cost_center_id bigint REFERENCES finance.cost_centers(id),
  ADD COLUMN IF NOT EXISTS reclass_requested_by  text,
  ADD COLUMN IF NOT EXISTS reclass_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reclass_proposed_cc_id bigint REFERENCES finance.cost_centers(id),
  ADD COLUMN IF NOT EXISTS reclass_by            text,
  ADD COLUMN IF NOT EXISTS reclass_at            timestamptz;

-- Add the 'reclassifying' status (charge blocked for the current head, waiting
-- for a reclassifier to assign a new CC).
ALTER TABLE finance.incoming_charges DROP CONSTRAINT IF EXISTS incoming_charges_status_check;
ALTER TABLE finance.incoming_charges
  ADD CONSTRAINT incoming_charges_status_check
  CHECK (status IN ('pending', 'approved', 'denied', 'reclassifying'));

-- ── RLS: reclassifiers see charges currently in reclassification ─────────────
DROP POLICY IF EXISTS incoming_charges_select ON finance.incoming_charges;
CREATE POLICY incoming_charges_select ON finance.incoming_charges
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      finance.is_head_of(cost_center_id)
      OR finance.has_role('finance'::finance.app_role)
      OR finance.has_role('fiscal'::finance.app_role)
      OR finance.has_role('admin'::finance.app_role)
      OR (status = 'reclassifying' AND finance.has_role('reclassifier'::finance.app_role))
    )
  );

-- ── request_charge_reclassification (current head) ───────────────────────────
-- The head of the charge's CC (or admin) asks to reclassify it, optionally
-- suggesting a new CC. Blocks the charge for the current head ('reclassifying').
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

REVOKE ALL ON FUNCTION finance.request_charge_reclassification(uuid, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.request_charge_reclassification(uuid, bigint) TO authenticated;

-- ── assign_reclassified_cc (reclassifier) ────────────────────────────────────
-- A reclassifier assigns the new CC; the charge returns to 'pending' under the
-- new CC's head. reclassified_cc_code carries the new CC code to the write-back.
CREATE OR REPLACE FUNCTION finance.assign_reclassified_cc(
  p_id uuid,
  p_new_cc_id bigint
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email   text := finance.jwt_email();
  v_charge  finance.incoming_charges%rowtype;
  v_code    text;
begin
  if not finance.is_vammo_user()
     or not (finance.has_role('reclassifier'::finance.app_role)
             or finance.has_role('admin'::finance.app_role)) then
    raise exception 'not authorized';
  end if;

  select * into v_charge from finance.incoming_charges where id = p_id for update;
  if not found then
    raise exception 'charge not found';
  end if;
  if v_charge.status <> 'reclassifying' then
    raise exception 'charge is not awaiting reclassification';
  end if;

  select code into v_code from finance.cost_centers where id = p_new_cc_id and active;
  if v_code is null then
    raise exception 'new cost center invalid or inactive';
  end if;

  update finance.incoming_charges set
    cost_center_id        = p_new_cc_id,
    reclassified_cc_code  = v_code,
    status                = 'pending',
    reclass_by            = v_email,
    reclass_at            = now()
  where id = p_id;
end;
$function$;

REVOKE ALL ON FUNCTION finance.assign_reclassified_cc(uuid, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.assign_reclassified_cc(uuid, bigint) TO authenticated;
