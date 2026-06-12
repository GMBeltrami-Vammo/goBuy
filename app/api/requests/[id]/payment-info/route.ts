import { after, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { notifyFinancePending } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PaymentInfoPayload {
  nf_number?: string;
  payment_due_date?: string;
  payment_method?: string;
  pix_key?: string;
  bank_name?: string;
  bank_agency?: string;
  bank_account?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.email || !isVammoEmail(session.user.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body: PaymentInfoPayload;
  try {
    body = (await request.json()) as PaymentInfoPayload;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  // RPC with the user's JWT — Postgres enforces ownership, status guard and
  // required fields/documents (single source of truth).
  const supabase = supabaseBrowser(session.supabaseToken ?? "");
  const { data, error } = await supabase.rpc("submit_payment_info", {
    p_request_id: id,
    p_payload: body,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notify finance that a request is ready for validation.
  after(async () => {
    try {
      const { data: req } = await supabaseAdmin()
        .from("purchase_requests")
        .select("display_id, supplier_name, total_amount, requester_email, expected_payment_date")
        .eq("id", id)
        .maybeSingle();
      if (req) {
        await notifyFinancePending({
          displayId: req.display_id as string,
          supplierName: req.supplier_name as string,
          totalAmount: Number(req.total_amount),
          requesterEmail: req.requester_email as string,
          expectedPaymentDate: (req.expected_payment_date as string | null) ?? null,
        });
      }
    } catch (err) {
      console.error("[slack notifyFinancePending] failed:", err);
    }
  });

  return NextResponse.json(data ?? { ok: true });
}
