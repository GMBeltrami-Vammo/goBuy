import "server-only";

export const SLACK_API = "https://slack.com/api";
const APP_URL = "https://gobuy-gray.vercel.app";

// ─── Test-mode routing ────────────────────────────────────────────────────────
// All messages go to gabriel.beltrami@vammo.com's DM with the bot.
// Replace with a per-user lookup (email → DM channel) when going live.
export const TEST_DM_CHANNEL = "D0AQE33791A";

// Slack user-id → email mapping (test mode only).
export const SLACK_USER_EMAIL: Record<string, string> = {
  U0AQE32LDNY: "gabriel.beltrami@vammo.com",
};

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

// ─── Head notification (new request, with approve/reject buttons) ─────────────
export async function notifyHead(req: HeadNotification): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack] SLACK_BOT_TOKEN not configured — skipping");
    return;
  }

  const ccLabel =
    req.costCenterCode && req.costCenterName
      ? `${req.costCenterCode} — ${req.costCenterName}`
      : (req.costCenterCode ?? req.costCenterName ?? "—");

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Nova solicitação · ${req.displayId}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Solicitante:*\n${req.requesterEmail}` },
        { type: "mrkdwn", text: `*Tipo:*\n${typeLabel(req.requestType)}` },
        { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
        { type: "mrkdwn", text: `*Valor:*\n${brl(req.totalAmount)}` },
        { type: "mrkdwn", text: `*Centro de custo:*\n${ccLabel}` },
      ],
    },
  ];

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
          text: { type: "mrkdwn", text: `Aprovar *${req.displayId}* de ${req.requesterEmail}?` },
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
      channel: TEST_DM_CHANNEL,
      text: `Nova solicitação ${req.displayId} — ${req.supplierName} · ${brl(req.totalAmount)}`,
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
      channel: TEST_DM_CHANNEL,
      text: `Solicitação ${req.displayId} ${status} por ${req.deciderEmail}`,
      blocks,
    });
  } catch (err) {
    console.error("[slack] notifyRequester failed:", err);
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
