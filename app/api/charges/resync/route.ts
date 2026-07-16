import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth";
import { isSameOrigin } from "@/lib/http";
import { writeChargeToSheet } from "@/lib/sheet-writeback";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Re-fire the sheet write-back for approved charges that were never written
 * (e.g. an approval that happened before the webhook was deployed, or a
 * transient failure). Admin-only. Idempotent — already-written charges are
 * skipped by the writer.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!ctx.isFullAppAdmin && !ctx.roles.includes("admin")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { data: charges, error } = await supabaseAdmin()
    .from("incoming_charges")
    .select("id, sheet_row, sheet_written_at")
    .eq("status", "approved")
    .is("sheet_written_at", null)
    .not("sheet_row", "is", null)
    .limit(500);

  if (error) {
    console.error("[charges/resync] query failed:", error.message);
    return NextResponse.json({ error: "Falha ao listar cobranças." }, { status: 500 });
  }

  let written = 0;
  for (const c of charges ?? []) {
    const ok = await writeChargeToSheet({
      id: c.id as string,
      sheet_row: c.sheet_row as number | null,
      sheet_written_at: null,
    });
    if (ok) written += 1;
  }

  return NextResponse.json({ attempted: charges?.length ?? 0, written });
}
