import "server-only";

import { writeChargeToSheet, type SheetWriteResult } from "@/lib/sheet-writeback";
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
 * source sheet. Pass an authenticated client whose JWT is the acting head's.
 */
export async function applyChargeDecision(
  supabase: ReturnType<typeof supabaseBrowser>,
  chargeId: string,
  action: "approve" | "deny",
  reason: string | null,
): Promise<ChargeDecisionResult> {
  const { error } = await supabase.rpc("decide_incoming_charge", {
    p_id: chargeId,
    p_action: action,
    p_reason: action === "deny" ? reason : null,
  });
  if (error) return { error: error.message };

  const { data: charge } = await supabaseAdmin()
    .from("incoming_charges")
    .select("sheet_row, sheet_written_at, created_at, decided_at, due_date")
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
      action,
    });
  }
  return { error: null, sheet };
}
