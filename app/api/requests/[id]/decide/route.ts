import { after, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { notifyRequester, notifyRequesterRenewal } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MONTHS_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function nextPeriodLabel(servicePeriod: string): string {
  const d = new Date();
  const months = servicePeriod === "Anual" ? 12 : servicePeriod === "Trimestral" ? 3 : 1;
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return `${MONTHS_PT[d.getMonth()]}/${d.getFullYear()}`;
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
  const deciderEmail = session.user.email;

  let body: { action?: string; reason?: string };
  try {
    body = (await request.json()) as { action?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const { action, reason } = body;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
  if (action === "reject" && !reason?.trim()) {
    return NextResponse.json({ error: "Informe o motivo da recusa." }, { status: 400 });
  }

  // RPC with user JWT — RLS enforces head-of-cost-center authorization.
  const supabase = supabaseBrowser(session.supabaseToken ?? "");
  const rpcResult =
    action === "approve"
      ? await supabase.rpc("approve_purchase_request", { p_request_id: id })
      : await supabase.rpc("reject_purchase_request", {
          p_request_id: id,
          p_reason: reason!.trim(),
        });

  if (rpcResult.error) {
    return NextResponse.json({ error: rpcResult.error.message }, { status: 500 });
  }

  // Notify the requester. after() runs the work once the response is sent and
  // keeps the function alive until it settles (a bare promise would be killed).
  after(async () => {
    try {
      const { data: req } = await supabaseAdmin()
        .from("purchase_requests")
        .select("display_id, supplier_name, total_amount, request_type, service_period")
        .eq("id", id)
        .maybeSingle();

      if (req) {
        await notifyRequester({
          displayId: req.display_id as string,
          action: action === "approve" ? "approved" : "rejected",
          deciderEmail,
          supplierName: req.supplier_name as string,
          totalAmount: Number(req.total_amount),
          reason: reason?.trim() ?? null,
        });

        const sp = req.service_period as string | null;
        if (
          action === "approve" &&
          req.request_type === "service" &&
          sp &&
          sp !== "Pontual / avulso"
        ) {
          await notifyRequesterRenewal({
            requestId: id,
            displayId: req.display_id as string,
            supplierName: req.supplier_name as string,
            totalAmount: Number(req.total_amount),
            servicePeriod: sp,
            nextPeriodLabel: nextPeriodLabel(sp),
          });
        }
      }
    } catch (err) {
      console.error("[slack notifyRequester] failed:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
