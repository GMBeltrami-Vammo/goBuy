import { createHmac, timingSafeEqual } from "node:crypto";

import { after, NextResponse } from "next/server";

import {
  SLACK_USER_EMAIL,
  notifyRequester,
  openRejectModal,
  updateHeadMessage,
} from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseBrowser } from "@/lib/supabase/client";
import { mintSupabaseToken } from "@/lib/supabase/token";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Slack signature verification (fail-closed) ───────────────────────────────
function verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    // Fail closed: never accept unsigned requests on a state-mutating endpoint.
    console.error("[slack/interact] SLACK_SIGNING_SECRET not configured — rejecting request");
    return false;
  }
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (!Number.isFinite(age) || age > 300) return false; // 5-min replay guard

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─── Request lookup (admin read, for building the notification only) ───────────
interface RequestRow {
  id: string;
  display_id: string;
  status: string;
  supplier_name: string;
  total_amount: number;
  requester_email: string;
}

async function getRequest(id: string): Promise<RequestRow | null> {
  const { data } = await supabaseAdmin()
    .from("purchase_requests")
    .select("id, display_id, status, supplier_name, total_amount, requester_email")
    .eq("id", id)
    .maybeSingle();
  return (data as RequestRow | null) ?? null;
}

/**
 * Apply a decision by calling the SAME Postgres RPC the web path uses, acting
 * as the head via a minted Supabase JWT. The RPC enforces is_vammo_user(),
 * is_head_of(), the pending-status guard, and the row lock atomically — so
 * authorization, race-safety, and business rules live in ONE place.
 */
async function applyDecision(
  actorEmail: string,
  requestId: string,
  action: "approve" | "reject",
  reason?: string,
): Promise<{ error: string | null }> {
  const token = await mintSupabaseToken(actorEmail);
  const supabase = supabaseBrowser(token);
  const res =
    action === "approve"
      ? await supabase.rpc("approve_purchase_request", { p_request_id: requestId })
      : await supabase.rpc("reject_purchase_request", {
          p_request_id: requestId,
          p_reason: reason ?? "",
        });
  return { error: res.error?.message ?? null };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  if (!verifySignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ error: "Missing payload." }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadStr) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const type = payload.type as string | undefined;
  const user = payload.user as { id?: string } | undefined;
  const slackUserId = user?.id;
  const actorEmail = slackUserId ? SLACK_USER_EMAIL[slackUserId] : undefined;

  // ── Block action: button click ──────────────────────────────────────────────
  if (type === "block_actions") {
    const actions = (payload.actions as { action_id?: string; value?: string }[] | undefined) ?? [];
    const action = actions[0];
    if (!action?.action_id) return new NextResponse(null, { status: 200 });

    // Link buttons (view_details) carry no server action.
    if (action.action_id.startsWith("view_details")) {
      return new NextResponse(null, { status: 200 });
    }

    if (!actorEmail) {
      console.error("[slack/interact] unrecognized Slack actor");
      return new NextResponse(null, { status: 200 });
    }

    const requestId = action.value ?? "";
    if (!UUID_RE.test(requestId)) {
      return new NextResponse(null, { status: 200 });
    }

    const container = payload.container as { channel_id?: string; message_ts?: string } | undefined;
    const channelId = container?.channel_id ?? "";
    const messageTs = container?.message_ts ?? "";

    if (action.action_id === "approve_request") {
      // Respond immediately; do the work after the response (Next.js after()).
      after(async () => {
        try {
          const req = await getRequest(requestId);
          if (!req) return;

          const { error } = await applyDecision(actorEmail, requestId, "approve");
          if (error) {
            console.error("[slack/interact] approve RPC rejected:", error);
            return; // not head, not pending, etc. — no notification on failure
          }

          if (channelId && messageTs) {
            await updateHeadMessage(channelId, messageTs, req.display_id, "approved", actorEmail);
          }
          await notifyRequester({
            displayId: req.display_id,
            action: "approved",
            deciderEmail: actorEmail,
            supplierName: req.supplier_name,
            totalAmount: Number(req.total_amount),
            reason: null,
          });
        } catch (err) {
          console.error("[slack/interact] approve failed:", err);
        }
      });

      return new NextResponse(null, { status: 200 });
    }

    if (action.action_id === "reject_request") {
      // Open a modal for the rejection reason (must be synchronous — needs trigger_id).
      const triggerId = payload.trigger_id as string | undefined;
      const req = await getRequest(requestId);
      if (!req || req.status !== "pending" || !triggerId) {
        return new NextResponse(null, { status: 200 });
      }
      try {
        await openRejectModal(triggerId, requestId, req.display_id, channelId, messageTs);
      } catch (err) {
        console.error("[slack/interact] openRejectModal failed:", err);
      }
      return new NextResponse(null, { status: 200 });
    }

    return new NextResponse(null, { status: 200 });
  }

  // ── View submission: rejection modal submitted ──────────────────────────────
  if (type === "view_submission") {
    const view = payload.view as {
      callback_id?: string;
      private_metadata?: string;
      state?: { values?: Record<string, Record<string, { value?: string }>> };
    } | undefined;

    if (!view || view.callback_id !== "reject_modal") {
      return new NextResponse(null, { status: 200 });
    }
    if (!actorEmail) return new NextResponse(null, { status: 200 });

    let meta: { requestId: string; displayId: string; channel: string; messageTsToUpdate: string };
    try {
      meta = JSON.parse(view.private_metadata ?? "{}");
    } catch {
      return NextResponse.json({
        response_action: "errors",
        errors: { reason_block: "Erro interno. Tente novamente pelo app." },
      });
    }
    if (!UUID_RE.test(meta.requestId ?? "")) {
      return new NextResponse(null, { status: 200 });
    }

    const reason = view.state?.values?.["reason_block"]?.["reason_input"]?.value?.trim() ?? "";
    if (reason.length < 5) {
      // Validation error keeps the modal open.
      return NextResponse.json({
        response_action: "errors",
        errors: { reason_block: "Informe um motivo com pelo menos 5 caracteres." },
      });
    }

    // Process after closing the modal.
    after(async () => {
      try {
        const req = await getRequest(meta.requestId);
        if (!req) return;

        const { error } = await applyDecision(actorEmail, meta.requestId, "reject", reason);
        if (error) {
          console.error("[slack/interact] reject RPC rejected:", error);
          return;
        }

        if (meta.channel && meta.messageTsToUpdate) {
          await updateHeadMessage(meta.channel, meta.messageTsToUpdate, meta.displayId, "rejected", actorEmail, reason);
        }
        await notifyRequester({
          displayId: meta.displayId,
          action: "rejected",
          deciderEmail: actorEmail,
          supplierName: req.supplier_name,
          totalAmount: Number(req.total_amount),
          reason,
        });
      } catch (err) {
        console.error("[slack/interact] reject submit failed:", err);
      }
    });

    return NextResponse.json({ response_action: "clear" });
  }

  return new NextResponse(null, { status: 200 });
}
