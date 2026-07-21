import "server-only";

import { brtHour, brtYmd } from "@/lib/format";
import { paymentSchedule } from "@/lib/payment-schedule";
import { type ChargeNotification, notifyChargeHead } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Quiet hours: never DM between 19:00 and 09:00 BRT — those are queued and the
// 09:00 cron drains them.
const isQuietHour = (hour: number): boolean => hour < 9 || hour >= 19;

const CHARGE_SELECT =
  "id, display_id, supplier_name, amount, currency, due_date, created_at, cost_center_id, cost_centers(code, name)";

interface ChargeRow {
  id: string;
  display_id: string;
  supplier_name: string;
  amount: number | string;
  currency: string;
  due_date: string | null;
  created_at: string;
  cost_center_id: number;
  cost_centers?: { code: string; name: string } | null;
  status?: string;
}

/** Build the Slack notification payload; data de pagamento is "if approved at
 *  `referenceIso`" (ingest time for immediate sends, send time for the drain). */
function toNotification(c: ChargeRow, referenceIso: string): ChargeNotification {
  const cc = c.cost_centers;
  return {
    chargeId: c.id,
    displayId: c.display_id,
    supplierName: c.supplier_name,
    amount: Number(c.amount),
    currency: c.currency,
    costCenterLabel: cc ? `${cc.code} — ${cc.name}` : null,
    dueDate: c.due_date,
    paymentDate: paymentSchedule(brtYmd(referenceIso), c.due_date).newPaymentDate,
  };
}

/** Heads of a cost center who have Slack notifications enabled (opt-in). */
async function optedInHeads(costCenterId: number): Promise<string[]> {
  const admin = supabaseAdmin();
  const { data: heads } = await admin
    .from("cost_center_heads")
    .select("head_email")
    .eq("cost_center_id", costCenterId);
  const emails = (heads ?? []).map((h) => (h as { head_email: string }).head_email);
  if (emails.length === 0) return [];
  const { data: prefs } = await admin
    .from("head_slack_prefs")
    .select("head_email")
    .in("head_email", emails)
    .eq("notifications_enabled", true);
  return (prefs ?? []).map((p) => (p as { head_email: string }).head_email);
}

/**
 * On ingest: record a queued notification per opted-in head (deduped on
 * charge+head), and send immediately during business hours. Quiet-hours arrivals
 * stay 'queued' for the 09:00 drain. Best-effort — never throws to the caller.
 */
export async function notifyChargeIngested(chargeId: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data } = await admin.from("incoming_charges").select(CHARGE_SELECT).eq("id", chargeId).maybeSingle();
  if (!data) return;
  const charge = data as unknown as ChargeRow;

  const heads = await optedInHeads(charge.cost_center_id);
  if (heads.length === 0) return;

  const nowIso = new Date().toISOString();
  const quiet = isQuietHour(brtHour(nowIso));

  for (const head_email of heads) {
    // Record intent; dedup on (charge, head). ignoreDuplicates → no row back if
    // it already existed, so we never double-send.
    const { data: inserted } = await admin
      .from("charge_notification_queue")
      .upsert(
        { charge_id: chargeId, head_email, status: "queued" },
        { onConflict: "charge_id,head_email", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (!inserted) continue; // already queued/sent
    if (quiet) continue; // the 09:00 drain will send it

    const sent = await notifyChargeHead(head_email, toNotification(charge, nowIso));
    if (sent) {
      await admin
        .from("charge_notification_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          slack_channel: sent.channel,
          slack_ts: sent.ts,
        })
        .eq("charge_id", chargeId)
        .eq("head_email", head_email);
    }
    // On failure the row stays 'queued' and the 09:00 drain retries it.
  }
}

/**
 * Cron (09:00 BRT): fire every still-queued notification as its own One-Tap
 * message. Re-checks that the head is still opted in and the charge is still
 * pending; otherwise marks the row 'skipped'.
 */
export async function drainChargeNotificationQueue(): Promise<{ sent: number; skipped: number }> {
  const admin = supabaseAdmin();
  const { data: rows } = await admin
    .from("charge_notification_queue")
    .select("id, charge_id, head_email")
    .eq("status", "queued")
    .limit(1000);

  let sent = 0;
  let skipped = 0;
  for (const row of (rows ?? []) as { id: number; charge_id: string; head_email: string }[]) {
    const [{ data: pref }, { data: chg }] = await Promise.all([
      admin.from("head_slack_prefs").select("notifications_enabled").eq("head_email", row.head_email).maybeSingle(),
      admin.from("incoming_charges").select(`${CHARGE_SELECT}, status`).eq("id", row.charge_id).maybeSingle(),
    ]);
    const enabled = (pref as { notifications_enabled?: boolean } | null)?.notifications_enabled ?? false;
    const charge = chg as unknown as ChargeRow | null;

    if (!charge || !enabled || charge.status !== "pending") {
      await admin.from("charge_notification_queue").update({ status: "skipped" }).eq("id", row.id);
      skipped++;
      continue;
    }

    const result = await notifyChargeHead(row.head_email, toNotification(charge, new Date().toISOString()));
    if (result) {
      await admin
        .from("charge_notification_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          slack_channel: result.channel,
          slack_ts: result.ts,
        })
        .eq("id", row.id);
      sent++;
    } else {
      // Unreachable head / transient failure — mark skipped so the queue drains.
      await admin.from("charge_notification_queue").update({ status: "skipped" }).eq("id", row.id);
      skipped++;
    }
  }
  return { sent, skipped };
}
