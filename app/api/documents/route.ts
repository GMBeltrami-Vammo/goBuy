import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";

export const runtime = "nodejs";

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};
const DOC_TYPES = new Set(["nota_fiscal", "quotation", "invoice", "receipt", "contract", "other"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sanitizeFilename = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80);

export async function POST(request: Request) {
  // 0) Same-origin check (CSRF defense-in-depth).
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  // 1) Session + domain gate via NextAuth.
  const session = await auth();
  if (!session?.user?.email || !isVammoEmail(session.user.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const email = session.user.email.toLowerCase();

  // 2) Input validation.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const file = form.get("file");
  const requestId = String(form.get("request_id") ?? "");
  const docType = String(form.get("doc_type") ?? "other");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  }
  if (!UUID_RE.test(requestId) || !DOC_TYPES.has(docType)) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Arquivo vazio ou acima de 25 MB." }, { status: 400 });
  }
  const allowedExts = ALLOWED_TYPES[file.type];
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  if (!allowedExts || !allowedExts.includes(ext)) {
    return NextResponse.json(
      { error: "Apenas PDF, PNG ou JPG são aceitos." },
      { status: 400 },
    );
  }

  // 3) Authorization: use the user's Supabase token so RLS checks visibility.
  const supabase = supabaseBrowser(session.supabaseToken ?? "");
  const { data: req } = await supabase
    .from("purchase_requests")
    .select("id, display_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) {
    return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });
  }
  if (req.status === "cancelled" || req.status === "rejected") {
    return NextResponse.json(
      { error: "Não é possível anexar documentos a solicitações canceladas ou recusadas." },
      { status: 409 },
    );
  }

  // 4) Store + register (service role, after authz above).
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const docId = randomUUID();
  const storagePath = `${req.display_id}/${docType}/${docId}_${sanitizeFilename(file.name)}`;

  const admin = supabaseAdmin();
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("document upload failed:", uploadError.message);
    return NextResponse.json({ error: "Falha ao armazenar o arquivo." }, { status: 500 });
  }

  const { data: doc, error: insertError } = await admin
    .from("request_documents")
    .insert({
      id: docId,
      request_id: requestId,
      doc_type: docType,
      storage_path: storagePath,
      original_filename: file.name.slice(-200),
      content_type: file.type,
      size_bytes: file.size,
      sha256,
      uploaded_by_email: email,
    })
    .select("id, doc_type, original_filename, size_bytes, created_at")
    .single();

  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    console.error("document insert failed:", insertError.message);
    return NextResponse.json({ error: "Falha ao registrar o documento." }, { status: 500 });
  }

  await admin.from("request_events").insert({
    request_id: requestId,
    event_type: "document_added",
    actor_email: email,
    detail: { doc_type: docType, filename: file.name.slice(-200), sha256 },
  });

  return NextResponse.json({ document: doc }, { status: 201 });
}
