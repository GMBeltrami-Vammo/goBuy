import { createHmac, timingSafeEqual } from "node:crypto";

import { after, NextResponse } from "next/server";

import { applyChargeDecision } from "@/lib/charge-decide";
import {
  SLACK_USER_EMAIL,
  RenewalNotification,
  lookupEmailBySlackUser,
  notifyHead,
  notifyRequester,
  notifyRequesterRenewal,
  openChargeRejectModal,
  openRejectModal,
  updateChargeMessage,
  updateHeadMessage,
  updateRenewalMessage,
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

async function getCharge(
  id: string,
): Promise<{ id: string; display_id: string; status: string } | null> {
  const { data } = await supabaseAdmin()
    .from("incoming_charges")
    .select("id, display_id, status")
    .eq("id", id)
    .maybeSingle();
  return (data as { id: string; display_id: string; status: string } | null) ?? null;
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

// ─── Renewal helpers ──────────────────────────────────────────────────────────
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setDate(1); // avoid end-of-month overflow before shifting
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

const MONTHS_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function nextPeriodLabel(servicePeriod: string): string {
  const months = servicePeriod === "Anual" ? 12 : servicePeriod === "Trimestral" ? 3 : 1;
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return `${MONTHS_PT[d.getMonth()]}/${d.getFullYear()}`;
}

interface RenewalRow {
  request_type: string;
  supplier_name: string;
  supplier_document: string | null;
  cost_center_id: number;
  justification: string | null;
  notes: string | null;
  total_amount: number;
  service_period: string | null;
  service_start: string | null;
  service_end: string | null;
}

async function submitRenewal(
  actorEmail: string,
  originalId: string,
): Promise<{ newId: string; newDisplayId: string; servicePeriod: string; error: string | null }> {
  const { data: orig } = await supabaseAdmin()
    .from("purchase_requests")
    .select(
      "request_type, supplier_name, supplier_document, cost_center_id, justification, notes, total_amount, service_period, service_start, service_end",
    )
    .eq("id", originalId)
    .maybeSingle();

  if (!orig) return { newId: "", newDisplayId: "", servicePeriod: "", error: "Solicitação original não encontrada." };

  const row = orig as RenewalRow;
  if (row.request_type !== "service") {
    return { newId: "", newDisplayId: "", servicePeriod: "", error: "Renovação disponível apenas para serviços." };
  }

  const advanceMonths = row.service_period === "Anual" ? 12 : row.service_period === "Trimestral" ? 3 : 1;

  const payload: Record<string, unknown> = {
    request_type: "service",
    supplier_name: row.supplier_name,
    supplier_document: row.supplier_document ?? null,
    cost_center_id: row.cost_center_id,
    justification: row.justification ?? null,
    notes: row.notes ?? null,
    total_amount: Number(row.total_amount),
    service_period: row.service_period,
  };
  if (row.service_start) payload.service_start = addMonths(row.service_start, advanceMonths);
  if (row.service_end) payload.service_end = addMonths(row.service_end, advanceMonths);

  const token = await mintSupabaseToken(actorEmail);
  const supabase = supabaseBrowser(token);
  const { data, error } = await supabase.rpc("submit_purchase_request", { p_payload: payload });

  if (error) return { newId: "", newDisplayId: "", servicePeriod: row.service_period ?? "", error: error.message };
  return {
    newId: (data as { id: string }).id,
    newDisplayId: (data as { display_id: string }).display_id,
    servicePeriod: row.service_period ?? "",
    error: null,
  };
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
  // Resolve the clicker's @vammo email: the test-mode map first, else a live
  // Slack lookup (users.info → profile.email). The RPC still enforces is_head_of.
  let resolvedEmail = slackUserId ? SLACK_USER_EMAIL[slackUserId] : undefined;
  if (!resolvedEmail && slackUserId) {
    resolvedEmail = (await lookupEmailBySlackUser(slackUserId)) ?? undefined;
  }
  const actorEmail = resolvedEmail;

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
          // Send renewal prompt if it's a recurring service.
          const { data: full } = await supabaseAdmin()
            .from("purchase_requests")
            .select("service_period, request_type")
            .eq("id", requestId)
            .maybeSingle();
          const sp = (full as { service_period?: string | null } | null)?.service_period;
          if (full && (full as { request_type: string }).request_type === "service" && sp && sp !== "Pontual / avulso") {
            await notifyRequesterRenewal({
              requestId,
              displayId: req.display_id,
              supplierName: req.supplier_name,
              totalAmount: Number(req.total_amount),
              servicePeriod: sp,
              nextPeriodLabel: nextPeriodLabel(sp),
            });
          }
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

    if (action.action_id === "renew_request") {
      if (!actorEmail) return new NextResponse(null, { status: 200 });
      after(async () => {
        try {
          const { newId, newDisplayId, servicePeriod, error } = await submitRenewal(actorEmail, requestId);
          if (error) {
            console.error("[slack/interact] renewal RPC failed:", error);
            return;
          }
          // Update the renewal prompt message in the requester's DM.
          if (channelId && messageTs) {
            await updateRenewalMessage(channelId, messageTs, action.value ?? "", newDisplayId);
          }
          // Notify the head about the new request (same flow as a web submission).
          const { data: orig } = await supabaseAdmin()
            .from("purchase_requests")
            .select("display_id, supplier_name, total_amount, cost_center_id, request_type, justification, requester_email")
            .eq("id", requestId)
            .maybeSingle();
          if (orig) {
            const { data: cc } = await supabaseAdmin()
              .from("cost_centers")
              .select("code, name")
              .eq("id", (orig as { cost_center_id: number }).cost_center_id)
              .maybeSingle();
            await notifyHead({
              requestId: newId,
              displayId: newDisplayId,
              requesterEmail: (orig as { requester_email: string }).requester_email,
              supplierName: (orig as { supplier_name: string }).supplier_name,
              totalAmount: Number((orig as { total_amount: number }).total_amount),
              requestType: (orig as { request_type: string }).request_type,
              costCenterCode: cc?.code ?? null,
              costCenterName: cc?.name ?? null,
              justification: (orig as { justification: string | null }).justification ?? null,
            });
            // Send next renewal prompt to the requester after this one is submitted.
            await notifyRequesterRenewal({
              requestId: newId,
              displayId: newDisplayId,
              supplierName: (orig as { supplier_name: string }).supplier_name,
              totalAmount: Number((orig as { total_amount: number }).total_amount),
              servicePeriod,
              nextPeriodLabel: nextPeriodLabel(servicePeriod),
            } as RenewalNotification);
          }
        } catch (err) {
          console.error("[slack/interact] renew_request failed:", err);
        }
      });
      return new NextResponse(null, { status: 200 });
    }

    // ── Charge (Cobranças demo) decisions ─────────────────────────────────────
    if (action.action_id === "approve_charge") {
      after(async () => {
        try {
          const charge = await getCharge(requestId);
          if (!charge) return;
          const { error } = await applyChargeDecision(
            supabaseBrowser(await mintSupabaseToken(actorEmail)),
            requestId,
            "approve",
            null,
          );
          if (error) {
            console.error("[slack/interact] approve_charge rejected:", error);
            return;
          }
          await updateChargeMessage(channelId, messageTs, charge.display_id, "approved", actorEmail);
        } catch (err) {
          console.error("[slack/interact] approve_charge failed:", err);
        }
      });
      return new NextResponse(null, { status: 200 });
    }

    if (action.action_id === "deny_charge") {
      const triggerId = payload.trigger_id as string | undefined;
      const charge = await getCharge(requestId);
      if (!charge || charge.status !== "pending" || !triggerId) {
        return new NextResponse(null, { status: 200 });
      }
      try {
        await openChargeRejectModal(triggerId, requestId, charge.display_id, channelId, messageTs);
      } catch (err) {
        console.error("[slack/interact] openChargeRejectModal failed:", err);
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

    // Charge (Cobranças) deny modal — mirrors reject_modal but decides a charge.
    if (view?.callback_id === "reject_charge_modal") {
      if (!actorEmail) return new NextResponse(null, { status: 200 });
      let cmeta: { chargeId: string; displayId: string; channel: string; messageTsToUpdate: string };
      try {
        cmeta = JSON.parse(view.private_metadata ?? "{}");
      } catch {
        return NextResponse.json({
          response_action: "errors",
          errors: { reason_block: "Erro interno. Tente novamente pelo app." },
        });
      }
      if (!UUID_RE.test(cmeta.chargeId ?? "")) {
        return new NextResponse(null, { status: 200 });
      }
      const creason = view.state?.values?.["reason_block"]?.["reason_input"]?.value?.trim() ?? "";
      if (creason.length < 5) {
        return NextResponse.json({
          response_action: "errors",
          errors: { reason_block: "Informe um motivo com pelo menos 5 caracteres." },
        });
      }
      after(async () => {
        try {
          const charge = await getCharge(cmeta.chargeId);
          if (!charge) return;
          const { error } = await applyChargeDecision(
            supabaseBrowser(await mintSupabaseToken(actorEmail)),
            cmeta.chargeId,
            "deny",
            creason,
          );
          if (error) {
            console.error("[slack/interact] deny_charge rejected:", error);
            return;
          }
          await updateChargeMessage(
            cmeta.channel,
            cmeta.messageTsToUpdate,
            cmeta.displayId,
            "denied",
            actorEmail,
            creason,
          );
        } catch (err) {
          console.error("[slack/interact] deny_charge submit failed:", err);
        }
      });
      return NextResponse.json({ response_action: "clear" });
    }

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
