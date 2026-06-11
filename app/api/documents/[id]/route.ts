import type { Session } from "next-auth";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";

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

  const session = (await auth()) as (Session & { supabaseToken?: string }) | null;
  if (!session?.user?.email || !isVammoEmail(session.user.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  // RLS decides visibility via the user's Supabase token.
  const supabase = supabaseBrowser(session.supabaseToken ?? "");
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
