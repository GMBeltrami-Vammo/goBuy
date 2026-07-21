import "server-only";

import { brtStamp, brtYmd, formatDateOnlyBR } from "@/lib/format";
import { headApprovalTimeString, nextPaymentDate, paymentSchedule } from "@/lib/payment-schedule";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Google Apps Script that writes TRUE back to the source spreadsheet row on
// approval. Override via env if the script is redeployed to a new URL.
const HEAD_APPROVAL_WEBHOOK_URL =
  process.env.HEAD_APPROVAL_WEBHOOK_URL ??
  "https://script.google.com/macros/s/AKfycbzR6GltHoDmUOoDmJw3Y_DH6PP3vozwkXRk9zm3d1Ff1iVFoPj0yhTEVyG7g8tO4BVp/exec";

/** Outcome of a write-back attempt. Surfaced in the decide response so a failure
 *  is diagnosable (it used to be visible only in Vercel logs). */
export type SheetWriteResult =
  | { ok: true; already?: boolean }
  | { ok: false; reason: "no_row" | "no_key" | "rejected" | "error"; detail?: string };

/**
 * Write the decision back to the source sheet row, then stamp
 * incoming_charges.sheet_written_at so it isn't written twice. Idempotent and
 * safe to retry: no-ops when already written or when there's no source row.
 *
 * On approval: head_approval_time carries the reprogramming narrative and
 * payment_date is the effective (rescheduled) payment date. On refusal:
 * head_approval_time is a "Recusada" stamp and payment_date is the on-time
 * (within-due-time) payment date — nextPaymentDate(vencimento), reprogrammed to
 * the next Tue/Fri — matching what an on-time approval would have paid.
 *
 * Apps Script always returns HTTP 200 (after a 302 redirect), with the real
 * outcome in the JSON body ({status:"error", …} on a rejected/failed write), so
 * we parse the body and only stamp on genuine success.
 */
export async function writeChargeToSheet(charge: {
  id: string;
  sheet_row: number | null;
  sheet_written_at: string | null;
  decided_at: string | null;
  due_date: string | null;
  action: "approve" | "deny";
}): Promise<SheetWriteResult> {
  if (charge.sheet_written_at) return { ok: true, already: true };
  if (charge.sheet_row == null) return { ok: false, reason: "no_row" };

  const secret = process.env.HEAD_APPROVAL_KEY;
  if (!secret) {
    console.error("[sheet-writeback] HEAD_APPROVAL_KEY not set — skipping");
    return { ok: false, reason: "no_key" };
  }

  // Decision time is the charge's decided_at (falling back to now), in BRT.
  const approvalIso = charge.decided_at ?? new Date().toISOString();
  let head_approval_time: string;
  let payment_date: string;
  if (charge.action === "deny") {
    // On refusal, record the on-time payment date (as if approved within due
    // time) — the payday after the Vencimento, reprogrammed to Tue/Fri.
    const onTime = nextPaymentDate(charge.due_date ?? brtYmd(approvalIso));
    head_approval_time = `${brtStamp(approvalIso)} - Recusada.`;
    payment_date = formatDateOnlyBR(onTime);
  } else {
    const { newPaymentDate, rescheduled } = paymentSchedule(brtYmd(approvalIso), charge.due_date);
    head_approval_time = headApprovalTimeString(approvalIso, charge.due_date, newPaymentDate, rescheduled);
    payment_date = formatDateOnlyBR(newPaymentDate); // DD/MM/YYYY
  }

  try {
    const res = await fetch(HEAD_APPROVAL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: charge.sheet_row, secret, head_approval_time, payment_date }),
      redirect: "follow",
    });
    const result = (await res.json().catch(() => null)) as
      | { status?: string; message?: string; error?: unknown }
      | null;
    const ok = res.ok && !!result && result.status !== "error" && !result.error;
    if (!ok) {
      console.error("[sheet-writeback] rejected:", res.status, result);
      return {
        ok: false,
        reason: "rejected",
        detail: `${res.status} ${result?.message ?? result?.status ?? "sem corpo JSON"}`.trim(),
      };
    }
    await supabaseAdmin()
      .from("incoming_charges")
      .update({ sheet_written_at: new Date().toISOString() })
      .eq("id", charge.id);
    return { ok: true };
  } catch (err) {
    console.error("[sheet-writeback] error:", err);
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}
