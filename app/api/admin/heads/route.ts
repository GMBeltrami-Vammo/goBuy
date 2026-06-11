import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ADMIN_EMAIL = "gabriel.beltrami@vammo.com";

async function requireAdmin() {
  const session = await auth();
  return session?.user?.email?.toLowerCase() === ADMIN_EMAIL ? session : null;
}

export async function POST(request: Request) {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
