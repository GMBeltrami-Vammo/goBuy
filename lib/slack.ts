import "server-only";

const SLACK_API = "https://slack.com/api/chat.postMessage";

// Test mode: all notifications are routed to gabriel.beltrami@vammo.com
const TEST_RECIPIENT_ID = "U0AQE32LDNY";

export interface NewRequestNotification {
  displayId: string;
  requesterEmail: string;
  supplierName: string;
  totalAmount: number;
  requestType: string;
  costCenterCode: string | null;
  costCenterName: string | null;
  justification: string | null;
}

export interface DecisionNotification {
  displayId: string;
  action: "approve" | "reject";
  deciderEmail: string;
  requesterEmail: string;
  supplierName: string;
  totalAmount: number;
  reason: string | null;
}

function typeLabel(t: string): string {
  return (
    ({ products: "Produtos / materiais", service: "Serviço", advance: "Adiantamento" } as Record<string, string>)[t] ?? t
  );
}

function brl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

async function postMessage(token: string, text: string, blocks: object[]): Promise<void> {
  let res: Response;
  try {
    res = await fetch(SLACK_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: TEST_RECIPIENT_ID, text, blocks }),
    });
  } catch (err) {
    console.error("[slack] fetch failed:", err);
    return;
  }

  if (!res.ok) {
    console.error("[slack] HTTP error:", res.status, await res.text().catch(() => ""));
    return;
  }

  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) console.error("[slack] API error:", json.error);
}

export async function notifyNewRequest(req: NewRequestNotification): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
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
      text: { type: "mrkdwn", text: `*Justificativa:*\n${req.justification.slice(0, 500)}` },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "Ver no goBuy", emoji: true },
        url: "https://gobuy-gray.vercel.app",
        action_id: "view_gobuy_new",
      },
    ],
  });

  await postMessage(
    token,
    `Nova solicitação ${req.displayId} — ${req.supplierName} · ${brl(req.totalAmount)}`,
    blocks,
  );
}

export async function notifyDecision(req: DecisionNotification): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("[slack] SLACK_BOT_TOKEN not configured — skipping");
    return;
  }

  const approved = req.action === "approve";
  const header = approved
    ? `Solicitação aprovada · ${req.displayId}`
    : `Solicitação recusada · ${req.displayId}`;

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: header, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Solicitante:*\n${req.requesterEmail}` },
        { type: "mrkdwn", text: `*Decidido por:*\n${req.deciderEmail}` },
        { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
        { type: "mrkdwn", text: `*Valor:*\n${brl(req.totalAmount)}` },
      ],
    },
  ];

  if (!approved && req.reason) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Motivo da recusa:*\n${req.reason.slice(0, 500)}` },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Ver no goBuy", emoji: true },
        url: "https://gobuy-gray.vercel.app",
        action_id: "view_gobuy_decision",
      },
    ],
  });

  const status = approved ? "aprovada" : "recusada";
  await postMessage(
    token,
    `Solicitação ${req.displayId} ${status} por ${req.deciderEmail}`,
    blocks,
  );
}
