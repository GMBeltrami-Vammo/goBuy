import "server-only";

import { formatDateOnlyBR } from "@/lib/format";

export const SLACK_API = "https://slack.com/api";
const APP_URL = "https://gobuy-gray.vercel.app";

// ─── Test-mode routing ────────────────────────────────────────────────────────
// All messages go to gabriel.beltrami@vammo.com's DM with THIS bot.
// A DM channel id is per-(bot,user): we can't hardcode one copied from another
// app's DM. Resolve it at runtime via conversations.open(users: <userId>).
// Replace with a per-user lookup (email → user id) when going live.
const TEST_RECIPIENT_USER_ID = "U0AQE32LDNY";

// Slack user-id → email mapping (test mode only).
export const SLACK_USER_EMAIL: Record<string, string> = {
  U0AQE32LDNY: "gabriel.beltrami@vammo.com",
};

// The bot's DM channel with a given user is stable, so memoize it across
// requests to avoid an extra conversations.open call per notification.
const dmChannelCache = new Map<string, string>();

/** Resolve (and cache) the DM channel id between the bot and a Slack user. */
export async function resolveDmChannel(userId: string): Promise<string> {
  const cached = dmChannelCache.get(userId);
  if (cached) return cached;
  const res = await slackPost("conversations.open", { users: userId });
  const channel = (res.channel as { id?: string } | undefined)?.id;
  if (!channel) throw new Error("conversations.open returned no channel id");
  dmChannelCache.set(userId, channel);
  return channel;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface HeadNotification {
  requestId: string;   // UUID (used in button values)
  displayId: string;   // e.g. GBY-0001
  requesterEmail: string;
  supplierName: string;
  totalAmount: number;
  requestType: string;
  costCenterCode: string | null;
  costCenterName: string | null;
  justification: string | null;
  /** Present when the request spans multiple cost centers (rateio). */
  allocations?: Array<{ ccCode: string; ccName: string; percentage: number }>;
}

export interface RequesterNotification {
  displayId: string;
  action: "approved" | "rejected";
  deciderEmail: string;
  supplierName: string;
  totalAmount: number;
  reason: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function typeLabel(t: string): string {
  return (
    ({ products: "Produtos / materiais", service: "Serviço", advance: "Adiantamento" } as Record<
      string,
      string
    >)[t] ?? t
  );
}

export function brl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN not configured");
  return t;
}

export async function slackPost(endpoint: string, body: object): Promise<{ ok: boolean; [k: string]: unknown }> {
  const res = await fetch(`${SLACK_API}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
  const json = (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
  if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
  return json;
}

/** GET Web API call (form/query args) — for read methods like users.* that
 *  don't accept a JSON body. */
async function slackGet(endpoint: string, params: Record<string, string>): Promise<{ ok: boolean; [k: string]: unknown }> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SLACK_API}/${endpoint}?${qs}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
  const json = (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
  if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
  return json;
}

/** Resolve a Slack user id from an email (needs the `users:read.email` scope).
 *  Returns null when the user isn't in the workspace / lookup fails. */
export async function lookupSlackUserByEmail(email: string): Promise<string | null> {
  if (!process.env.SLACK_BOT_TOKEN) return null;
  try {
    const res = await slackGet("users.lookupByEmail", { email });
    return (res.user as { id?: string } | undefined)?.id ?? null;
  } catch (err) {
    console.error(`[slack] lookupByEmail(${email}) failed:`, err);
    return null;
  }
}

/** Resolve the @vammo email of the Slack user who clicked a button (authz). */
export async function lookupEmailBySlackUser(userId: string): Promise<string | null> {
  if (!process.env.SLACK_BOT_TOKEN) return null;
  try {
    const res = await slackGet("users.info", { user: userId });
    const email = (res.user as { profile?: { email?: string } } | undefined)?.profile?.email;
    return email ? email.toLowerCase() : null;
  } catch (err) {
    console.error(`[slack] users.info(${userId}) failed:`, err);
    return null;
  }
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);
  } catch {
    return brl(n);
  }
}

// ─── Head notification (new request, with approve/reject buttons) ─────────────
export async function notifyHead(req: HeadNotification): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack] SLACK_BOT_TOKEN not configured — skipping");
    return;
  }

  const isRateio = (req.allocations?.length ?? 0) > 1;

  const ccLabel =
    req.costCenterCode && req.costCenterName
      ? `${req.costCenterCode} — ${req.costCenterName}`
      : (req.costCenterCode ?? req.costCenterName ?? "—");

  // Main fields — CC shown inline for single-CC; replaced by rateio count for rateio
  const mainFields: object[] = [
    { type: "mrkdwn", text: `*Solicitante:*\n${req.requesterEmail}` },
    { type: "mrkdwn", text: `*Tipo:*\n${typeLabel(req.requestType)}` },
    { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
    { type: "mrkdwn", text: `*Valor:*\n${brl(req.totalAmount)}` },
    isRateio
      ? { type: "mrkdwn", text: `*Rateio:*\n${req.allocations!.length} centros de custo` }
      : { type: "mrkdwn", text: `*Centro de custo:*\n${ccLabel}` },
  ];

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Nova solicitação · ${req.displayId}`, emoji: true },
    },
    { type: "section", fields: mainFields },
  ];

  // Rateio breakdown
  if (isRateio) {
    const bullets = req.allocations!
      .map((a) => `• ${a.ccCode} — ${a.ccName} · *${a.percentage}%*`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: bullets },
    });
  }

  if (req.justification) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Justificativa:*\n${req.justification.slice(0, 500)}`,
      },
    });
  }

  blocks.push({ type: "divider" });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "✅  Aprovar", emoji: true },
        action_id: "approve_request",
        value: req.requestId,
        confirm: {
          title: { type: "plain_text", text: "Confirmar aprovação" },
          text: {
            type: "mrkdwn",
            text: isRateio
              ? `Aprovar *${req.displayId}* (rateio entre ${req.allocations!.length} CCs) de ${req.requesterEmail}?`
              : `Aprovar *${req.displayId}* de ${req.requesterEmail}?`,
          },
          confirm: { type: "plain_text", text: "Aprovar" },
          deny: { type: "plain_text", text: "Cancelar" },
          style: "primary",
        },
      },
      {
        type: "button",
        style: "danger",
        text: { type: "plain_text", text: "❌  Recusar", emoji: true },
        action_id: "reject_request",
        value: req.requestId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🔗  Ver detalhes", emoji: true },
        url: `${APP_URL}/approvals?r=${encodeURIComponent(req.displayId)}`,
        action_id: "view_details_head",
      },
    ],
  });

  try {
    await slackPost("chat.postMessage", {
      channel: await resolveDmChannel(TEST_RECIPIENT_USER_ID),
      text: `Nova solicitação ${req.displayId} — ${req.supplierName} · ${brl(req.totalAmount)}${isRateio ? ` (rateio ${req.allocations!.length} CCs)` : ""}`,
      blocks,
    });
  } catch (err) {
    console.error("[slack] notifyHead failed:", err);
  }
}

// ─── Requester notification (decision made) ───────────────────────────────────
export async function notifyRequester(req: RequesterNotification): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack] SLACK_BOT_TOKEN not configured — skipping");
    return;
  }

  const approved = req.action === "approved";
  const headerText = approved
    ? `✅  Solicitação aprovada · ${req.displayId}`
    : `❌  Solicitação recusada · ${req.displayId}`;

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: headerText, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
        { type: "mrkdwn", text: `*Valor:*\n${brl(req.totalAmount)}` },
        {
          type: "mrkdwn",
          text: `*${approved ? "Aprovado por" : "Recusado por"}:*\n${req.deciderEmail}`,
        },
      ],
    },
  ];

  if (!approved && req.reason) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Motivo da recusa:*\n${req.reason.slice(0, 500)}`,
      },
    });
  }

  if (approved) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `📎 *Próximo passo — pagamento:*\n` +
          `Anexe a *nota fiscal* e preencha os dados de pagamento (vencimento, Pix/transferência/boleto) ` +
          `na solicitação para enviá-la ao financeiro. Sem a nota fiscal o pagamento não é processado.\n` +
          `_Pagamentos ocorrem às terças e sextas._`,
      },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "🔗  Ver detalhes", emoji: true },
        url: `${APP_URL}/?r=${encodeURIComponent(req.displayId)}`,
        action_id: "view_details_requester",
      },
    ],
  });

  try {
    const status = approved ? "aprovada" : "recusada";
    await slackPost("chat.postMessage", {
      channel: await resolveDmChannel(TEST_RECIPIENT_USER_ID),
      text: `Solicitação ${req.displayId} ${status} por ${req.deciderEmail}`,
      blocks,
    });
  } catch (err) {
    console.error("[slack] notifyRequester failed:", err);
  }
}

// ─── Finance notification (payment info submitted, awaiting validation) ───────
export interface FinancePendingNotification {
  displayId: string;
  supplierName: string;
  totalAmount: number;
  requesterEmail: string;
  expectedPaymentDate: string | null;
}

export async function notifyFinancePending(req: FinancePendingNotification): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `💰  Aguardando financeiro · ${req.displayId}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
        { type: "mrkdwn", text: `*Valor:*\n${brl(req.totalAmount)}` },
        { type: "mrkdwn", text: `*Solicitante:*\n${req.requesterEmail}` },
        {
          type: "mrkdwn",
          text: `*Previsão de pagamento:*\n${req.expectedPaymentDate ?? "—"}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Documentos e dados de pagamento enviados. Valide para mover a *Aguardando pagamento*.",
      },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🔗  Validar no goBuy", emoji: true },
          url: `${APP_URL}/finance?r=${encodeURIComponent(req.displayId)}`,
          action_id: "view_details_finance",
        },
      ],
    },
  ];

  try {
    await slackPost("chat.postMessage", {
      channel: await resolveDmChannel(TEST_RECIPIENT_USER_ID),
      text: `Solicitação ${req.displayId} aguardando validação do financeiro`,
      blocks,
    });
  } catch (err) {
    console.error("[slack] notifyFinancePending failed:", err);
  }
}

// ─── Update head message after decision (remove buttons, show outcome) ─────────
export async function updateHeadMessage(
  channel: string,
  ts: string,
  displayId: string,
  action: "approved" | "rejected",
  actorEmail: string,
  reason?: string,
): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;

  const approved = action === "approved";
  const label = approved ? "Aprovada ✅" : "Recusada ❌";

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${label} · ${displayId}`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${approved ? "Aprovada" : "Recusada"} por *${actorEmail}*${reason ? `\nMotivo: _${reason}_` : ""}`,
      },
    },
  ];

  try {
    await slackPost("chat.update", { channel, ts, blocks, text: `${label} · ${displayId}` });
  } catch (err) {
    console.error("[slack] updateHeadMessage failed:", err);
  }
}

// ─── Renewal prompt (recurring service approved) ─────────────────────────────
export interface RenewalNotification {
  requestId: string;
  displayId: string;
  supplierName: string;
  totalAmount: number;
  servicePeriod: string;
  nextPeriodLabel: string; // e.g. "Julho/2026"
}

export async function notifyRequesterRenewal(req: RenewalNotification): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔄  Renovar · ${req.displayId}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
        { type: "mrkdwn", text: `*Valor:*\n${brl(req.totalAmount)}` },
        { type: "mrkdwn", text: `*Periodicidade:*\n${req.servicePeriod}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Solicitação *${req.displayId}* aprovada. Use o botão abaixo para criar a renovação para *${req.nextPeriodLabel}* com os mesmos dados — o head receberá a notificação normalmente.`,
      },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: `🔄  Renovar para ${req.nextPeriodLabel}`, emoji: true },
          action_id: "renew_request",
          value: req.requestId,
          confirm: {
            title: { type: "plain_text", text: "Confirmar renovação" },
            text: {
              type: "mrkdwn",
              text: `Criar nova solicitação idêntica para *${req.nextPeriodLabel}*?`,
            },
            confirm: { type: "plain_text", text: "Renovar" },
            deny: { type: "plain_text", text: "Cancelar" },
            style: "primary",
          },
        },
      ],
    },
  ];

  try {
    await slackPost("chat.postMessage", {
      channel: await resolveDmChannel(TEST_RECIPIENT_USER_ID),
      text: `Renovar solicitação ${req.displayId} para ${req.nextPeriodLabel}`,
      blocks,
    });
  } catch (err) {
    console.error("[slack] notifyRequesterRenewal failed:", err);
  }
}

/** Update a renewal prompt message after the renewal is submitted. */
export async function updateRenewalMessage(
  channel: string,
  ts: string,
  originalDisplayId: string,
  newDisplayId: string,
): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    await slackPost("chat.update", {
      channel,
      ts,
      text: `Renovação ${newDisplayId} enviada.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅  Solicitação *${newDisplayId}* criada como renovação de *${originalDisplayId}*. O head será notificado para aprovação.`,
          },
        },
      ],
    });
  } catch (err) {
    console.error("[slack] updateRenewalMessage failed:", err);
  }
}

// ─── Open rejection modal ─────────────────────────────────────────────────────
export async function openRejectModal(
  triggerId: string,
  requestId: string,
  displayId: string,
  channel: string,
  messageTsToUpdate: string,
): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;

  await slackPost("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "reject_modal",
      private_metadata: JSON.stringify({ requestId, displayId, channel, messageTsToUpdate }),
      title: { type: "plain_text", text: "Recusar solicitação" },
      submit: { type: "plain_text", text: "Confirmar recusa" },
      close: { type: "plain_text", text: "Cancelar" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `Recusando *${displayId}*. Informe o motivo:` },
        },
        {
          type: "input",
          block_id: "reason_block",
          element: {
            type: "plain_text_input",
            action_id: "reason_input",
            multiline: true,
            min_length: 5,
            placeholder: { type: "plain_text", text: "Descreva o motivo da recusa…" },
          },
          label: { type: "plain_text", text: "Motivo" },
        },
      ],
    },
  });
}

// ─── Charge notification (Cobranças demo — One-Tap approve/deny) ──────────────
export interface ChargeNotification {
  chargeId: string; // UUID (button value)
  displayId: string; // CH-0001
  supplierName: string;
  amount: number;
  currency: string;
  costCenterLabel: string | null; // "1001 — Marketing"
  dueDate: string | null; // yyyy-mm-dd (Vencimento)
  paymentDate: string | null; // yyyy-mm-dd (data de pagamento se aprovar agora)
}

/**
 * DM a cost-center head a One-Tap charge notification (summary + Approve/Deny +
 * link to /cobrancas). Resolves the head's DM by email. Returns the posted
 * message's {channel, ts} so a later decision can update it; null on failure /
 * when the head isn't reachable on Slack.
 */
export async function notifyChargeHead(
  headEmail: string,
  req: ChargeNotification,
): Promise<{ channel: string; ts: string } | null> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack] SLACK_BOT_TOKEN not configured — skipping");
    return null;
  }
  const userId = await lookupSlackUserByEmail(headEmail);
  if (!userId) {
    console.warn(`[slack] no Slack user for ${headEmail} — skipping charge ${req.displayId}`);
    return null;
  }
  const channel = await resolveDmChannel(userId);

  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: `Nova cobrança · ${req.displayId}`, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
        { type: "mrkdwn", text: `*Valor:*\n${money(req.amount, req.currency)}` },
        { type: "mrkdwn", text: `*Centro de custo:*\n${req.costCenterLabel ?? "—"}` },
        { type: "mrkdwn", text: `*Vencimento:*\n${req.dueDate ? formatDateOnlyBR(req.dueDate) : "—"}` },
        { type: "mrkdwn", text: `*Data de pagamento:*\n${req.paymentDate ? formatDateOnlyBR(req.paymentDate) : "—"}` },
      ],
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "✅  Aprovar", emoji: true },
          action_id: "approve_charge",
          value: req.chargeId,
          confirm: {
            title: { type: "plain_text", text: "Confirmar aprovação" },
            text: { type: "mrkdwn", text: `Aprovar *${req.displayId}* — ${req.supplierName}?` },
            confirm: { type: "plain_text", text: "Aprovar" },
            deny: { type: "plain_text", text: "Cancelar" },
            style: "primary",
          },
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "❌  Recusar", emoji: true },
          action_id: "deny_charge",
          value: req.chargeId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔗  Ver no goBuy", emoji: true },
          url: `${APP_URL}/cobrancas`,
          action_id: "view_details_charge",
        },
      ],
    },
  ];

  try {
    const res = await slackPost("chat.postMessage", {
      channel,
      text: `Nova cobrança ${req.displayId} — ${req.supplierName} · ${money(req.amount, req.currency)}`,
      blocks,
    });
    return { channel, ts: (res.ts as string | undefined) ?? "" };
  } catch (err) {
    console.error("[slack] notifyChargeHead failed:", err);
    return null;
  }
}

/** Update a charge message after a decision (remove buttons, show outcome). */
export async function updateChargeMessage(
  channel: string,
  ts: string,
  displayId: string,
  action: "approved" | "denied",
  actorEmail: string,
  reason?: string,
): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN || !channel || !ts) return;
  const label = action === "approved" ? "Aprovada ✅" : "Recusada ❌";
  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: `${label} · ${displayId}`, emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${action === "approved" ? "Aprovada" : "Recusada"} por *${actorEmail}*${reason ? `\nMotivo: _${reason}_` : ""}`,
      },
    },
  ];
  try {
    await slackPost("chat.update", { channel, ts, blocks, text: `${label} · ${displayId}` });
  } catch (err) {
    console.error("[slack] updateChargeMessage failed:", err);
  }
}

/** Open the deny-reason modal for a charge (mirrors the in-app deny). */
export async function openChargeRejectModal(
  triggerId: string,
  chargeId: string,
  displayId: string,
  channel: string,
  messageTsToUpdate: string,
): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  await slackPost("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "reject_charge_modal",
      private_metadata: JSON.stringify({ chargeId, displayId, channel, messageTsToUpdate }),
      title: { type: "plain_text", text: "Recusar cobrança" },
      submit: { type: "plain_text", text: "Confirmar recusa" },
      close: { type: "plain_text", text: "Cancelar" },
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `Recusando *${displayId}*. Informe o motivo:` } },
        {
          type: "input",
          block_id: "reason_block",
          element: {
            type: "plain_text_input",
            action_id: "reason_input",
            multiline: true,
            min_length: 5,
            placeholder: { type: "plain_text", text: "Descreva o motivo da recusa…" },
          },
          label: { type: "plain_text", text: "Motivo" },
        },
      ],
    },
  });
}
