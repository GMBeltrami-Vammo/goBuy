import "server-only";

import { brtHour, brtYmd } from "@/lib/format";
import { paymentSchedule } from "@/lib/payment-schedule";
import { parseRateio } from "@/lib/rateio";
import { type ChargeNotification, notifyChargeHead } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Quiet hours: never DM between 19:00 and 09:00 BRT — those are queued and the
// 09:00 cron drains them.
const isQuietHour = (hour: number): boolean => hour < 9 || hour >= 19;

const CHARGE_SELECT =
  "id, display_id, supplier_name, amount, currency, due_date, created_at, observation, cost_center_id, cost_centers(code, name)";

interface ChargeRow {
  id: string;
  display_id: string;
  supplier_name: string;
  amount: number | string;
  currency: string;
  due_date: string | null;
  created_at: string;
  observation: string | null;
  cost_center_id: number;
  cost_centers?: { code: string; name: string } | null;
  status?: string;
}

/** Build the Slack notification payload; data de pagamento is "if approved at
 *  `referenceIso`" (ingest time for immediate sends, send time for the drain).
 *  A rateio charge carries its per-CC split so the DM doesn't misrepresent the
 *  full amount as landing on the primary CC. */
function toNotification(c: ChargeRow, referenceIso: string): ChargeNotification {
  const cc = c.cost_centers;
  const segs = parseRateio(c.observation);
  return {
    chargeId: c.id,
    displayId: c.display_id,
    supplierName: c.supplier_name,
    amount: Number(c.amount),
    currency: c.currency,
    costCenterLabel: cc ? `${cc.code} — ${cc.name}` : null,
    dueDate: c.due_date,
    paymentDate: paymentSchedule(brtYmd(referenceIso), c.due_date).newPaymentDate,
    rateio:
      segs.length > 1
        ? segs.map((s) => ({ code: s.code, label: s.label, pct: s.pct, amount: s.amount }))
        : undefined,
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
    // Failure-isolated per head: one head's error never skips the others.
    try {
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
        const { error: upErr } = await admin
          .from("charge_notification_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            slack_channel: sent.channel,
            slack_ts: sent.ts,
          })
          .eq("charge_id", chargeId)
          .eq("head_email", head_email);
        // If this write fails the row stays 'queued' and the drain may re-send a
        // duplicate — surface it so the rare case is diagnosable.
        if (upErr) console.error("[charge-notify] mark-sent failed:", upErr.message);
      }
      // On send failure the row stays 'queued' and the 09:00 drain retries it.
    } catch (err) {
      console.error(`[charge-notify] ingest notify failed for ${head_email}:`, err);
    }
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
    try {
      const [{ data: pref }, { data: chg }] = await Promise.all([
        admin.from("head_slack_prefs").select("notifications_enabled").eq("head_email", row.head_email).maybeSingle(),
        admin.from("incoming_charges").select(`${CHARGE_SELECT}, status`).eq("id", row.charge_id).maybeSingle(),
      ]);
      const enabled = (pref as { notifications_enabled?: boolean } | null)?.notifications_enabled ?? false;
      const charge = chg as unknown as ChargeRow | null;

      // Still-a-head re-check: a head removed from the CC between ingest and the
      // 09:00 drain must NOT get the DM (RLS would deny them the charge in-app).
      let stillHead = false;
      if (charge) {
        const { data: headRow } = await admin
          .from("cost_center_heads")
          .select("cost_center_id")
          .eq("cost_center_id", charge.cost_center_id)
          .eq("head_email", row.head_email)
          .maybeSingle();
        stillHead = !!headRow;
      }

      if (!charge || !enabled || !stillHead || charge.status !== "pending") {
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
        // Unreachable head / failure — mark skipped so the queue drains.
        await admin.from("charge_notification_queue").update({ status: "skipped" }).eq("id", row.id);
        skipped++;
      }
    } catch (err) {
      // One bad row must never abort the batch — leave it 'queued' for a retry.
      console.error(`[charge-notify] drain row ${row.id} failed:`, err);
      skipped++;
    }
  }
  return { sent, skipped };
}
