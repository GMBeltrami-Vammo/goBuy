import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth";
import { isSameOrigin } from "@/lib/http";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET — list all requests (for test cleanup UI)
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.roles.includes("admin")) {
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
    console.error("[admin/cleanup GET] query failed:", error.message);
    return NextResponse.json({ error: "Não foi possível carregar as solicitações." }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}

// DELETE — permanently remove a single request and its storage files
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const ctx = await getSessionContext();
  if (!ctx?.roles.includes("admin")) {
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

  // Remove files from storage first, capturing any that couldn't be deleted so
  // they can be surfaced (orphaned files would otherwise linger silently).
  let orphanWarning: string | undefined;
  if (docs?.length) {
    const paths = docs.map((d) => d.storage_path as string);
    const { data: removed, error: rmError } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .remove(paths);
    if (rmError) {
      console.error("[admin/cleanup DELETE] storage remove failed:", rmError.message);
      orphanWarning = `${paths.length} arquivo(s) podem não ter sido removidos do storage.`;
    } else if ((removed?.length ?? 0) < paths.length) {
      orphanWarning = `${paths.length - (removed?.length ?? 0)} arquivo(s) não foram encontrados no storage.`;
    }
  }

  // Delete the request — CASCADE removes items, events, documents, slack queue
  const { error } = await admin
    .from("purchase_requests")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[admin/cleanup DELETE] delete failed:", error.message);
    return NextResponse.json({ error: "Não foi possível excluir a solicitação." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, warning: orphanWarning });
}
