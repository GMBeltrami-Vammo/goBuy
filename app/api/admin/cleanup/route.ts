import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ADMIN_EMAIL = "gabriel.beltrami@vammo.com";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET — list all requests (for test cleanup UI)
export async function GET() {
  const session = await auth();
  if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("purchase_requests")
    .select(
      "id, display_id, status, requester_email, supplier_name, total_amount, currency, created_at, cost_centers(code, name, department)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}

// DELETE — permanently remove a single request and its storage files
export async function DELETE(request: Request) {
  const session = await auth();
  if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const id = String((body as Record<string, unknown>).id ?? "");
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Fetch storage paths before cascade-delete removes the rows
  const { data: docs } = await admin
    .from("request_documents")
    .select("storage_path")
    .eq("request_id", id);

  // Remove files from storage (best-effort — don't block on failure)
  if (docs?.length) {
    const paths = docs.map((d) => d.storage_path as string);
    await admin.storage.from(DOCUMENTS_BUCKET).remove(paths);
  }

  // Delete the request — CASCADE removes items, events, documents, slack queue
  const { error } = await admin
    .from("purchase_requests")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
