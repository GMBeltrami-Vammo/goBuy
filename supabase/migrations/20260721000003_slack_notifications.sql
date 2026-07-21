-- Slack head notifications for the Cobranças demo. Per-head opt-in (default
-- OFF); a queue backs quiet-hours stacking (19:00–09:00 BRT) drained by a daily
-- 09:00 cron. Reuses finance.is_vammo_user()/has_role()/jwt_email().

-- ── Per-head notification preference (opt-in, default off) ───────────────────
CREATE TABLE IF NOT EXISTS finance.head_slack_prefs (
  head_email            text PRIMARY KEY,
  notifications_enabled boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance.head_slack_prefs ENABLE ROW LEVEL SECURITY;

-- A head sees their own pref; finance/admin see all. Writes go through the RPC.
DROP POLICY IF EXISTS head_slack_prefs_select ON finance.head_slack_prefs;
CREATE POLICY head_slack_prefs_select ON finance.head_slack_prefs
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      head_email = finance.jwt_email()
      OR finance.has_role('finance'::finance.app_role)
      OR finance.has_role('admin'::finance.app_role)
    )
  );

GRANT SELECT ON finance.head_slack_prefs TO authenticated;

-- Toggle own preference.
CREATE OR REPLACE FUNCTION finance.set_slack_pref(p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not finance.is_vammo_user() then
    raise exception 'not authorized';
  end if;
  insert into finance.head_slack_prefs (head_email, notifications_enabled, updated_at)
  values (finance.jwt_email(), coalesce(p_enabled, false), now())
  on conflict (head_email)
  do update set notifications_enabled = excluded.notifications_enabled, updated_at = now();
end;
$function$;

REVOKE ALL ON FUNCTION finance.set_slack_pref(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.set_slack_pref(boolean) TO authenticated;

-- ── Notification queue (dedup + status + Slack message coordinates) ──────────
-- One row per (charge, head) intended notification. Written only by the service
-- role (ingest route + cron); no client writes. slack_channel/slack_ts are
-- stored so a later decision (Slack or in-app) can update the original message.
CREATE TABLE IF NOT EXISTS finance.charge_notification_queue (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  charge_id     uuid NOT NULL REFERENCES finance.incoming_charges(id) ON DELETE CASCADE,
  head_email    text NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped')),
  slack_channel text,
  slack_ts      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  CONSTRAINT charge_notification_queue_uq UNIQUE (charge_id, head_email)
);

CREATE INDEX IF NOT EXISTS charge_notification_queue_status_idx
  ON finance.charge_notification_queue (status);

ALTER TABLE finance.charge_notification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS charge_notification_queue_select ON finance.charge_notification_queue;
CREATE POLICY charge_notification_queue_select ON finance.charge_notification_queue
  FOR SELECT USING (
    finance.is_vammo_user() AND (
      finance.has_role('finance'::finance.app_role)
      OR finance.has_role('admin'::finance.app_role)
    )
  );

GRANT SELECT ON finance.charge_notification_queue TO authenticated;
