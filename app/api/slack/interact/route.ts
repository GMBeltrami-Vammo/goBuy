import { createHmac, timingSafeEqual } from "node:crypto";

import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";

import {
  SLACK_USER_EMAIL,
  notifyRequester,
  openRejectModal,
  updateHeadMessage,
} from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// ─── Slack signature verification ────────────────────────────────────────────
function verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.warn("[slack/interact] SLACK_SIGNING_SECRET not set — skipping verification");
    return true; // allow in dev; block in prod by adding the env var
  }

  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
  if (age > 300) return false; // replay attack guard (5 min)

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── DB helpers (admin client, explicit authz before calling) ─────────────────
interface RequestRow {
  id: string;
  display_id: string;
  status: string;
  supplier_name: string;
  total_amount: number;
  requester_email: string;
  cost_center_id: number;
}

async function getRequest(id: string): Promise<RequestRow | null> {
  const { data } = await supabaseAdmin()
    .from("purchase_requests")
    .select("id, display_id, status, supplier_name, total_amount, requester_email, cost_center_id")
    .eq("id", id)
    .maybeSingle();
  return data as RequestRow | null;
}

async function isHead(email: string, costCenterId: number): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("cost_center_heads")
    .select("head_email")
    .eq("cost_center_id", costCenterId)
    .eq("head_email", email)
    .maybeSingle();
  return !!data;
}

async function approveRequest(requestId: string, actorEmail: string): Promise<void> {
  const admin = supabaseAdmin();
  await admin
    .from("purchase_requests")
    .update({ status: "approved", decided_by_email: actorEmail, decided_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");

  await admin.from("request_events").insert({
    request_id: requestId,
    event_type: "approved",
    actor_email: actorEmail,
    detail: { via: "slack" },
  });
}

async function rejectRequest(requestId: string, actorEmail: string, reason: string): Promise<void> {
  const admin = supabaseAdmin();
  await admin
    .from("purchase_requests")
    .update({
      status: "rejected",
      decided_by_email: actorEmail,
      decided_at: new Date().toISOString(),
      decision_reason: reason,
    })
    .eq("id", requestId)
    .eq("status", "pending");

  await admin.from("request_events").insert({
    request_id: requestId,
    event_type: "rejected",
    actor_email: actorEmail,
    detail: { via: "slack", reason },
  });
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

  const type = payload.type as string;

  // ── Block action: button click ──────────────────────────────────────────────
  if (type === "block_actions") {
    const actions = (payload.actions as { action_id: string; value: string }[]) ?? [];
    const action = actions[0];
    if (!action) return new NextResponse(null, { status: 200 });

    const slackUserId = (payload.user as { id: string }).id;
    const actorEmail = SLACK_USER_EMAIL[slackUserId];
    if (!actorEmail) {
      console.error("[slack/interact] unknown Slack user:", slackUserId);
      return new NextResponse(null, { status: 200 });
    }

    // Link buttons (view_details) — no action needed
    if (action.action_id.startsWith("view_details")) {
      return new NextResponse(null, { status: 200 });
    }

    const requestId = action.value;
    const container = payload.container as { channel_id: string; message_ts: string };

    if (action.action_id === "approve_request") {
      // Process approval after responding. waitUntil guarantees the work
      // runs to completion — a bare promise would be killed at response time.
      waitUntil(
        (async () => {
          try {
            const req = await getRequest(requestId);
            if (!req || req.status !== "pending") return;
            if (!(await isHead(actorEmail, req.cost_center_id))) return;

            await approveRequest(requestId, actorEmail);
            await updateHeadMessage(container.channel_id, container.message_ts, req.display_id, "approved", actorEmail);
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
        })(),
      );

      return new NextResponse(null, { status: 200 });
    }

    if (action.action_id === "reject_request") {
      // Open a modal for the rejection reason
      const req = await getRequest(requestId);
      if (!req || req.status !== "pending") return new NextResponse(null, { status: 200 });

      const triggerId = payload.trigger_id as string;
      try {
        await openRejectModal(
          triggerId,
          requestId,
          req.display_id,
          container.channel_id,
          container.message_ts,
        );
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
      callback_id: string;
      private_metadata: string;
      state: { values: Record<string, Record<string, { value: string }>> };
    };

    if (view.callback_id !== "reject_modal") {
      return new NextResponse(null, { status: 200 });
    }

    const slackUserId = (payload.user as { id: string }).id;
    const actorEmail = SLACK_USER_EMAIL[slackUserId];
    if (!actorEmail) return new NextResponse(null, { status: 200 });

    const meta = JSON.parse(view.private_metadata) as {
      requestId: string;
      displayId: string;
      channel: string;
      messageTsToUpdate: string;
    };

    const reason = view.state.values["reason_block"]?.["reason_input"]?.value?.trim() ?? "";
    if (!reason) {
      // Return validation error — modal stays open
      return NextResponse.json({
        response_action: "errors",
        errors: { reason_block: "Informe o motivo da recusa." },
      });
    }

    // Process after closing the modal. waitUntil guarantees completion.
    waitUntil(
      (async () => {
        try {
          const req = await getRequest(meta.requestId);
          if (!req || req.status !== "pending") return;
          if (!(await isHead(actorEmail, req.cost_center_id))) return;

          await rejectRequest(meta.requestId, actorEmail, reason);
          await updateHeadMessage(meta.channel, meta.messageTsToUpdate, meta.displayId, "rejected", actorEmail, reason);
          await notifyRequester({
            displayId: meta.displayId,
            action: "rejected",
            deciderEmail: actorEmail,
            supplierName: req.supplier_name,
            totalAmount: Number(req.total_amount),
            reason,
          });
        } catch (err) {
          console.error("[slack/interact] reject modal submit failed:", err);
        }
      })(),
    );

    // Close the modal
    return NextResponse.json({ response_action: "clear" });
  }

  return new NextResponse(null, { status: 200 });
}
