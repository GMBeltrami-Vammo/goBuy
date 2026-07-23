import "server-only";

import { formatDateOnlyBR } from "@/lib/format";
import { headApprovalTimeString, paymentSchedule } from "@/lib/payment-schedule";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Google Apps Script that writes TRUE back to the source spreadsheet row on
// approval. Override via env if the script is redeployed to a new URL.
const HEAD_APPROVAL_WEBHOOK_URL =
  process.env.HEAD_APPROVAL_WEBHOOK_URL ??
  "https://script.google.com/macros/s/AKfycbzR6GltHoDmUOoDmJw3Y_DH6PP3vozwkXRk9zm3d1Ff1iVFoPj0yhTEVyG7g8tO4BVp/exec";

// Confidential RH charges (sheet "RH") write back to a separate Apps Script.
const RH_WEBHOOK_URL =
  process.env.HEAD_APPROVAL_WEBHOOK_URL_RH ??
  "https://script.google.com/macros/s/AKfycbxXoFvQem9Ol2_uwdyID3yNIby0esRHNFTXeNxbbDV8LJlFTppn5gftSIRTOgNa-OwC/exec";

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
 * On approval: payment_date is the effective (reprogrammed) date computed from
 * the approval time, and head_approval_time carries the timestamped reprogram
 * narrative. On refusal: head_approval_time is simply "Recusada" and payment_date
 * is fixed at ingest — the data de pagamento as of when the charge arrived via
 * the API (created_at), not recomputed at decision time.
 *
 * Apps Script always returns HTTP 200 (after a 302 redirect), with the real
 * outcome in the JSON body ({status:"error", …} on a rejected/failed write), so
 * we parse the body and only stamp on genuine success.
 */
export async function writeChargeToSheet(charge: {
  id: string;
  sheet_row: number | null;
  sheet_written_at: string | null;
  created_at: string | null;
  decided_at: string | null;
  due_date: string | null;
  reclassified_cc_code: string | null;
  sheet_name: string | null;
  action: "approve" | "deny";
}): Promise<SheetWriteResult> {
  if (charge.sheet_written_at) return { ok: true, already: true };
  if (charge.sheet_row == null) return { ok: false, reason: "no_row" };

  const secret = process.env.HEAD_APPROVAL_KEY;
  if (!secret) {
    console.error("[sheet-writeback] HEAD_APPROVAL_KEY not set — skipping");
    return { ok: false, reason: "no_key" };
  }

  // Payment date is derived purely from the API date (the requested payment
  // date), snapped to a Tue/Fri — it does not depend on the decision time.
  const sched = paymentSchedule(charge.due_date);
  const payment_date = sched.paymentDate ? formatDateOnlyBR(sched.paymentDate) : ""; // DD/MM/YYYY
  let head_approval_time: string;
  if (charge.action === "deny") {
    // Refusal: message is just "Recusada"; payment_date is the date it would have had.
    head_approval_time = "Recusada";
  } else {
    // Approval: timestamped narrative; "reprogramado" when the API date was moved.
    const approvalIso = charge.decided_at ?? new Date().toISOString();
    head_approval_time = sched.paymentDate
      ? headApprovalTimeString(approvalIso, sched.apiDate, sched.paymentDate, sched.adjusted)
      : "Aprovada";
  }

  // Confidential RH charges write back to their own Apps Script.
  const webhookUrl = charge.sheet_name === "RH" ? RH_WEBHOOK_URL : HEAD_APPROVAL_WEBHOOK_URL;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // new_cc: the reassigned CC code when the charge went through
      // reclassification, "" otherwise (always present).
      body: JSON.stringify({
        row: charge.sheet_row,
        secret,
        head_approval_time,
        payment_date,
        new_cc: charge.reclassified_cc_code ?? "",
      }),
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
