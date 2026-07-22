import "server-only";

import { writeChargeToSheet, type SheetWriteResult } from "@/lib/sheet-writeback";
import { updateChargeMessage } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { supabaseBrowser } from "@/lib/supabase/client";

export interface ChargeDecisionResult {
  error: string | null;
  sheet?: SheetWriteResult;
}

/**
 * Apply a head's decision to an incoming charge and run the sheet write-back —
 * the single canonical path shared by the web route (session token) and the
 * Slack interaction handler (minted token). The RPC enforces is_head_of() +
 * the pending guard atomically; the write-back reflects the decision on the
 * source sheet. Pass an authenticated client whose JWT is the acting head's,
 * and the acting head's email (for the Slack message reconciliation below).
 */
export async function applyChargeDecision(
  supabase: ReturnType<typeof supabaseBrowser>,
  chargeId: string,
  action: "approve" | "deny",
  reason: string | null,
  actorEmail: string,
): Promise<ChargeDecisionResult> {
  const { error } = await supabase.rpc("decide_incoming_charge", {
    p_id: chargeId,
    p_action: action,
    p_reason: action === "deny" ? reason : null,
  });
  if (error) return { error: error.message };

  const admin = supabaseAdmin();
  const { data: charge } = await admin
    .from("incoming_charges")
    .select("display_id, sheet_row, sheet_written_at, created_at, decided_at, due_date, reclassified_cc_code, sheet_name")
    .eq("id", chargeId)
    .maybeSingle();

  let sheet: SheetWriteResult | undefined;
  if (charge) {
    sheet = await writeChargeToSheet({
      id: chargeId,
      sheet_row: charge.sheet_row as number | null,
      sheet_written_at: charge.sheet_written_at as string | null,
      created_at: charge.created_at as string | null,
      decided_at: charge.decided_at as string | null,
      due_date: charge.due_date as string | null,
      reclassified_cc_code: charge.reclassified_cc_code as string | null,
      sheet_name: charge.sheet_name as string | null,
      action,
    });
  }

  // Reconcile every Slack DM sent for this charge (all co-heads): remove the
  // live Approve/Deny buttons and show the outcome — whether the decision came
  // from the web app or another head's Slack tap. Best-effort; never fails the
  // decision.
  try {
    const displayId = (charge as { display_id?: string } | null)?.display_id ?? chargeId;
    const { data: msgs } = await admin
      .from("charge_notification_queue")
      .select("slack_channel, slack_ts")
      .eq("charge_id", chargeId)
      .eq("status", "sent");
    for (const m of (msgs ?? []) as { slack_channel: string | null; slack_ts: string | null }[]) {
      if (m.slack_channel && m.slack_ts) {
        await updateChargeMessage(
          m.slack_channel,
          m.slack_ts,
          displayId,
          action === "approve" ? "approved" : "denied",
          actorEmail,
          reason ?? undefined,
        );
      }
    }
  } catch (err) {
    console.error("[charge-decide] Slack reconcile failed:", err);
  }

  return { error: null, sheet };
}
