import { NextResponse } from "next/server";

import { isVammoEmail } from "@/lib/auth";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isVammoEmail(user.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  // RLS decides visibility: the row only comes back if the caller may see
  // the parent request (owner, head of the center, finance/fiscal/admin).
  const { data: doc } = await supabase
    .from("request_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!doc) {
    return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  }

  const admin = supabaseAdmin();
  const { data: signed, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, 60);
  if (error || !signed) {
    console.error("signed url failed:", error?.message);
    return NextResponse.json({ error: "Falha ao gerar o link." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
