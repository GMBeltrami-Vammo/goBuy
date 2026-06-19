import { after, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { isSameOrigin } from "@/lib/http";
import { notifyHead } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";

export const runtime = "nodejs";

interface RequestPayload {
  request_type?: string;
  supplier_name?: string;
  cost_center_id?: number;
  justification?: string | null;
  total_amount?: number;
  items?: { quantity: number; unit_value: number }[];
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user?.email || !isVammoEmail(session.user.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const requesterEmail = session.user.email;

  let payload: RequestPayload;
  try {
    payload = (await request.json()) as RequestPayload;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const supabase = supabaseBrowser(session.supabaseToken ?? "");
  const { data, error } = await supabase.rpc("submit_purchase_request", { p_payload: payload });

  if (error) {
    console.error("[submit_purchase_request] rpc failed:", error.message);
    return NextResponse.json(
      { error: "Não foi possível enviar a solicitação. Verifique os campos e tente novamente." },
      { status: 400 },
    );
  }

  // Compute total for Slack (mirrors new-request-modal logic).
  let totalAmount = 0;
  if (typeof payload.total_amount === "number") {
    totalAmount = payload.total_amount;
  } else if (Array.isArray(payload.items)) {
    totalAmount = payload.items.reduce((s, i) => s + (i.quantity ?? 0) * (i.unit_value ?? 0), 0);
  }

  // Notify head(s) with Approve/Reject buttons. For rateio, all allocation CCs
  // are shown in a single message. after() keeps the function alive until settled.
  after(async () => {
    try {
      const requestId = (data as { id: string }).id;
      const displayId = (data as { display_id: string }).display_id;

      // Fetch all allocations with CC info so rateio is visible in the message.
      const { data: allocRows } = await supabaseAdmin()
        .from("request_allocations")
        .select("percentage, cost_centers(code, name)")
        .eq("request_id", requestId);

      type AllocRow = { percentage: string | number; cost_centers: { code: string; name: string } | null };
      const allocations = ((allocRows ?? []) as unknown as AllocRow[]).map((a) => ({
        ccCode: a.cost_centers?.code ?? "—",
        ccName: a.cost_centers?.name ?? "—",
        percentage: Number(a.percentage),
      }));

      await notifyHead({
        requestId,
        displayId,
        requesterEmail,
        supplierName: payload.supplier_name ?? "—",
        totalAmount,
        requestType: payload.request_type ?? "products",
        costCenterCode: allocations[0]?.ccCode ?? null,
        costCenterName: allocations[0]?.ccName ?? null,
        justification: payload.justification ?? null,
        allocations: allocations.length > 1 ? allocations : undefined,
      });
    } catch (err) {
      console.error("[slack notifyHead] failed:", err);
    }
  });

  return NextResponse.json(data, { status: 201 });
}
