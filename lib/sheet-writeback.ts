import "server-only";

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
 * Write TRUE back to the source sheet row for an approved charge, then stamp
 * incoming_charges.sheet_written_at so it isn't written twice. Idempotent and
 * safe to retry: no-ops when already written or when there's no source row.
 *
 * Apps Script always returns HTTP 200 (after a 302 redirect), with the real
 * outcome in the JSON body ({status:"error", …} on a rejected/failed write), so
 * we parse the body and only stamp on genuine success.
 */
export async function writeChargeToSheet(charge: {
  id: string;
  sheet_row: number | null;
  sheet_written_at: string | null;
}): Promise<SheetWriteResult> {
  if (charge.sheet_written_at) return { ok: true, already: true };
  if (charge.sheet_row == null) return { ok: false, reason: "no_row" };

  const secret = process.env.HEAD_APPROVAL_KEY;
  if (!secret) {
    console.error("[sheet-writeback] HEAD_APPROVAL_KEY not set — skipping");
    return { ok: false, reason: "no_key" };
  }

  try {
    const res = await fetch(HEAD_APPROVAL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: charge.sheet_row, secret }),
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
