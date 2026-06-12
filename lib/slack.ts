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

function typeLabel(t: string): string {
  return (
    ({ products: "Produtos / materiais", service: "Serviço", advance: "Adiantamento" } as Record<string, string>)[t] ?? t
  );
}

function brl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

export async function notifyNewRequest(req: NewRequestNotification): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("[slack] SLACK_BOT_TOKEN not configured — skipping notification");
    return;
  }

  const ccLabel =
    req.costCenterCode && req.costCenterName
      ? `${req.costCenterCode} — ${req.costCenterName}`
      : (req.costCenterCode ?? req.costCenterName ?? "—");

  const fields = [
    { type: "mrkdwn", text: `*Solicitante:*\n${req.requesterEmail}` },
    { type: "mrkdwn", text: `*Tipo:*\n${typeLabel(req.requestType)}` },
    { type: "mrkdwn", text: `*Fornecedor:*\n${req.supplierName}` },
    { type: "mrkdwn", text: `*Valor:*\n${brl(req.totalAmount)}` },
    { type: "mrkdwn", text: `*Centro de custo:*\n${ccLabel}` },
  ];

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Nova solicitação · ${req.displayId}`, emoji: true },
    },
    { type: "section", fields },
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

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "Ver no goBuy", emoji: true },
        url: "https://gobuy-gray.vercel.app",
        action_id: "view_gobuy",
      },
    ],
  });

  let res: Response;
  try {
    res = await fetch(SLACK_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: TEST_RECIPIENT_ID,
        text: `Nova solicitação ${req.displayId} — ${req.supplierName} · ${brl(req.totalAmount)}`,
        blocks,
      }),
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
  if (!json.ok) {
    console.error("[slack] API error:", json.error);
  }
}
