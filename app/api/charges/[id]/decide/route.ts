import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { applyChargeDecision } from "@/lib/charge-decide";
import { isSameOrigin } from "@/lib/http";
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

  // RPC (is_head_of enforced) + sheet write-back via the shared canonical path.
  const supabase = supabaseBrowser(session.supabaseToken ?? "");
  const { error, sheet } = await applyChargeDecision(
    supabase,
    id,
    action,
    action === "deny" ? reason!.trim() : null,
  );

  if (error) {
    console.error("[charges/decide] decision failed:", error);
    return NextResponse.json(
      { error: "Não foi possível processar a decisão. Atualize a página e tente novamente." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, sheet });
}
