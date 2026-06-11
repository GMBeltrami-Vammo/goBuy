import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Slack one-click approval — DISABLED. No messages are ever sent.
 *
 * The DB function finance.submit_purchase_request() queues rows in
 * finance.slack_notification_queue (status 'queued'), but there is no worker
 * that reads that queue and no Slack credentials are configured. Nothing is
 * dispatched until a worker is explicitly wired up.
 *
 * When ready to enable (future work):
 * 1. Add SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET to env.
 * 2. Build a worker (n8n / Vercel cron) that dequeues 'queued' rows, mints
 *    single-use tokens, and sends Slack DMs with Approve/Reject buttons.
 * 3. Implement this endpoint: verify X-Slack-Signature, match token hash,
 *    call finance.approve_purchase_request / reject_purchase_request RPCs,
 *    mark row 'actioned', respond within 3 s.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Integração Slack não habilitada." },
    { status: 501 },
  );
}
