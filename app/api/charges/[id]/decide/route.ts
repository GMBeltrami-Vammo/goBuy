import { after, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { isSameOrigin } from "@/lib/http";
import { writeChargeToSheet } from "@/lib/sheet-writeback";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.email || !isVammoEmail(session.user.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body: { action?: string; reason?: string };
  try {
    body = (await request.json()) as { action?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const { action, reason } = body;
  if (action !== "approve" && action !== "deny") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
  if (action === "deny" && !reason?.trim()) {
    return NextResponse.json({ error: "Informe o motivo da recusa." }, { status: 400 });
  }

  // RPC with the user JWT — RLS + is_head_of enforce head-of-cost-center authorization.
  const supabase = supabaseBrowser(session.supabaseToken ?? "");
  const { error } = await supabase.rpc("decide_incoming_charge", {
    p_id: id,
    p_action: action,
    p_reason: action === "deny" ? reason!.trim() : null,
  });

  if (error) {
    console.error("[charges/decide] rpc failed:", error.message);
    return NextResponse.json(
      { error: "Não foi possível processar a decisão. Atualize a página e tente novamente." },
      { status: 400 },
    );
  }

  // On approval, tell the Google Apps Script to write TRUE back to the source
  // row. Runs after the response so it never blocks the head's action; the
  // sheet_written_at stamp guards against a double write.
  if (action === "approve") {
    after(async () => {
      const { data: charge } = await supabaseAdmin()
        .from("incoming_charges")
        .select("sheet_row, sheet_written_at")
        .eq("id", id)
        .maybeSingle();
      if (charge) {
        await writeChargeToSheet({
          id,
          sheet_row: charge.sheet_row as number | null,
          sheet_written_at: charge.sheet_written_at as string | null,
        });
      }
    });
  }

  return NextResponse.json({ ok: true });
}
