import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { notifyNewRequest } from "@/lib/slack";
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

  // RPC runs with the user's JWT so RLS sees the correct requester identity.
  const supabase = supabaseBrowser(session.supabaseToken ?? "");
  const { data, error } = await supabase.rpc("submit_purchase_request", {
    p_payload: payload,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Compute total for the Slack message (mirrors new-request-modal logic).
  let totalAmount = 0;
  if (typeof payload.total_amount === "number") {
    totalAmount = payload.total_amount;
  } else if (Array.isArray(payload.items)) {
    totalAmount = payload.items.reduce(
      (s, i) => s + (i.quantity ?? 0) * (i.unit_value ?? 0),
      0,
    );
  }

  // Fire-and-forget Slack DM — errors here never block the response.
  void (async () => {
    try {
      const { data: cc } = await supabaseAdmin()
        .from("cost_centers")
        .select("code, name")
        .eq("id", payload.cost_center_id ?? 0)
        .maybeSingle();

      await notifyNewRequest({
        displayId: (data as { display_id: string }).display_id,
        requesterEmail,
        supplierName: payload.supplier_name ?? "—",
        totalAmount,
        requestType: payload.request_type ?? "products",
        costCenterCode: cc?.code ?? null,
        costCenterName: cc?.name ?? null,
        justification: payload.justification ?? null,
      });
    } catch (err) {
      console.error("[slack notify] failed:", err);
    }
  })();

  return NextResponse.json(data, { status: 201 });
}
