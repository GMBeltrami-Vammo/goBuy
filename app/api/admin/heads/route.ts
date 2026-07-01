import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth";
import { isSameOrigin } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function requireAdmin() {
  const ctx = await getSessionContext();
  return ctx?.roles.includes("admin") ? ctx : null;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const costCenterId = Number(b.cost_center_id);
  const headEmail = String(b.head_email ?? "").toLowerCase().trim();
  const headName = String(b.head_name ?? "").trim() || null;

  if (!costCenterId || !headEmail.endsWith("@vammo.com")) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("cost_center_heads")
    .upsert(
      { cost_center_id: costCenterId, head_email: headEmail, head_name: headName },
      { onConflict: "cost_center_id,head_email" },
    );

  if (error) {
    console.error("[admin/heads POST] upsert failed:", error.message);
    return NextResponse.json({ error: "Não foi possível salvar o responsável." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const costCenterId = Number(b.cost_center_id);
  const headEmail = String(b.head_email ?? "").toLowerCase().trim();

  if (!costCenterId || !headEmail) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("cost_center_heads")
    .delete()
    .eq("cost_center_id", costCenterId)
    .eq("head_email", headEmail);

  if (error) {
    console.error("[admin/heads DELETE] delete failed:", error.message);
    return NextResponse.json({ error: "Não foi possível remover o responsável." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
