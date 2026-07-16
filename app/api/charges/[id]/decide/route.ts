import { after, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { isSameOrigin } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Google Apps Script that writes TRUE back to the source spreadsheet row on
// approval. Override via env if the script is redeployed to a new URL.
const HEAD_APPROVAL_WEBHOOK_URL =
  process.env.HEAD_APPROVAL_WEBHOOK_URL ??
  "https://script.google.com/macros/s/AKfycbzR6GltHoDmUOoDmJw3Y_DH6PP3vozwkXRk9zm3d1Ff1iVFoPj0yhTEVyG7g8tO4BVp/exec";

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
      try {
        const admin = supabaseAdmin();
        const { data: charge } = await admin
          .from("incoming_charges")
          .select("sheet_row, sheet_written_at")
          .eq("id", id)
          .maybeSingle();

        const secret = process.env.HEAD_APPROVAL_KEY;
        if (!secret) {
          console.error("[charges/decide] HEAD_APPROVAL_KEY not set — skipping sheet write-back");
          return;
        }
        if (charge?.sheet_row == null || charge.sheet_written_at) return;

        const res = await fetch(HEAD_APPROVAL_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ row: charge.sheet_row, secret }),
        });
        // Apps Script always returns HTTP 200; the real outcome is in the JSON
        // body (e.g. {status:"error", code:401} on a rejected/failed write).
        // Only stamp sheet_written_at when the script actually reports success.
        const result = (await res.json().catch(() => null)) as
          | { status?: string; code?: number; error?: unknown }
          | null;
        const wrote = res.ok && !!result && result.status !== "error" && !result.error;
        if (wrote) {
          await admin
            .from("incoming_charges")
            .update({ sheet_written_at: new Date().toISOString() })
            .eq("id", id);
        } else {
          console.error("[charges/decide] sheet write-back failed:", res.status, result);
        }
      } catch (err) {
        console.error("[charges/decide] sheet write-back failed:", err);
      }
    });
  }

  return NextResponse.json({ ok: true });
}
