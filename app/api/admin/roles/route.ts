import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";

export const runtime = "nodejs";

const ADMIN_EMAIL = "gabriel.beltrami@vammo.com";

async function requireAdmin() {
  const session = await auth();
  return session?.user?.email?.toLowerCase() === ADMIN_EMAIL ? session : null;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const [rolesRes, headsRes, centersRes] = await Promise.all([
    admin
      .from("user_roles")
      .select("user_email, role, created_at")
      .order("user_email"),
    admin
      .from("cost_center_heads")
      .select("cost_center_id, head_email, head_name"),
    admin
      .from("cost_centers")
      .select("id, code, name, department")
      .eq("active", true)
      .order("code"),
  ]);

  return NextResponse.json({
    roles: rolesRes.data ?? [],
    heads: headsRes.data ?? [],
    costCenters: centersRes.data ?? [],
  });
}

const VALID_ROLES: AppRole[] = ["finance", "fiscal", "admin"];

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

  const email = String((body as Record<string, unknown>).email ?? "")
    .toLowerCase()
    .trim();
  const role = (body as Record<string, unknown>).role as AppRole;

  if (!email.endsWith("@vammo.com")) {
    return NextResponse.json({ error: "Apenas e-mails @vammo.com." }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Role inválida." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("user_roles")
    .upsert(
      { user_email: email, role, granted_by_email: ADMIN_EMAIL },
      { onConflict: "user_email,role" },
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

  const email = String((body as Record<string, unknown>).email ?? "")
    .toLowerCase()
    .trim();
  const role = (body as Record<string, unknown>).role as AppRole;

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Role inválida." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("user_roles")
    .delete()
    .eq("user_email", email)
    .eq("role", role);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
