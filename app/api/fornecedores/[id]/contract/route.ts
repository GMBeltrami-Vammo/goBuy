import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth";
import { isSameOrigin } from "@/lib/http";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const ID_RE = /^\d+$/;

const sanitizeFilename = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80);

/**
 * A contract PDF can be uploaded/replaced by the supplier's registrant or by
 * finance/admin. Visibility (RLS) is not enough — an approved supplier is
 * visible to everyone — so we authorize explicitly here.
 */
async function authorize(id: string) {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Não autorizado.", status: 401 as const };

  const { data: forn } = await supabaseAdmin()
    .from("fornecedores")
    .select("id, created_by_email, contract_storage_path")
    .eq("id", Number(id))
    .maybeSingle();
  if (!forn) return { error: "Fornecedor não encontrado.", status: 404 as const };

  const canManage =
    ctx.roles.includes("finance") ||
    ctx.roles.includes("admin") ||
    forn.created_by_email === ctx.email;
  if (!canManage) return { error: "Não autorizado.", status: 403 as const };

  return { ctx, forn };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const { id } = await params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  }

  const authz = await authorize(id);
  if ("error" in authz) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { ctx, forn } = authz;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Arquivo vazio ou acima de 25 MB." }, { status: 400 });
  }
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  if (file.type !== "application/pdf" || ext !== ".pdf") {
    return NextResponse.json({ error: "Apenas PDF é aceito." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const storagePath = `fornecedores/${id}/contract/${randomUUID()}_${sanitizeFilename(file.name)}`;

  const admin = supabaseAdmin();
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    console.error("[fornecedor contract] upload failed:", uploadError.message);
    return NextResponse.json({ error: "Falha ao armazenar o arquivo." }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("fornecedores")
    .update({
      contract_storage_path: storagePath,
      contract_filename: file.name.slice(-200),
      contract_content_type: "application/pdf",
      contract_size_bytes: file.size,
    })
    .eq("id", Number(id));

  if (updateError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    console.error("[fornecedor contract] update failed:", updateError.message);
    return NextResponse.json({ error: "Falha ao registrar o contrato." }, { status: 500 });
  }

  // Replacing an existing contract: drop the previous object now that the row points at the new one.
  if (forn.contract_storage_path && forn.contract_storage_path !== storagePath) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([forn.contract_storage_path]);
  }

  await admin.from("fornecedor_events").insert({
    fornecedor_id: Number(id),
    event_type: "contract_added",
    actor_email: ctx.email,
    detail: { filename: file.name.slice(-200), size_bytes: file.size },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  }

  const authz = await authorize(id);
  if ("error" in authz) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { forn } = authz;

  if (!forn.contract_storage_path) {
    return NextResponse.json({ error: "Sem contrato anexado." }, { status: 404 });
  }

  const { data: signed, error } = await supabaseAdmin()
    .storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(forn.contract_storage_path, 60);
  if (error || !signed) {
    console.error("[fornecedor contract] signed url failed:", error?.message);
    return NextResponse.json({ error: "Falha ao gerar o link." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
