import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Slack one-click approval — STRUCTURE ONLY (v2).
 *
 * Designed flow (not yet operable, no Slack credentials configured):
 * 1. finance.submit_purchase_request() already queues one row per cost-center
 *    head in finance.slack_notification_queue (status 'queued').
 * 2. A worker (n8n or Vercel cron) will: generate a single-use token, store
 *    its SHA-256 hash in action_token_hash, send the Slack DM with
 *    Approve/Reject buttons whose action payload carries the raw token, and
 *    mark the row 'sent'.
 * 3. Slack POSTs interactions here. This endpoint must then:
 *    - verify the Slack signing secret (X-Slack-Signature + timestamp, ±5 min);
 *    - hash the received token and match it against action_token_hash
 *      (single use: reject if actioned_at is already set);
 *    - resolve the head's email from the queue row and call the same
 *      finance.approve_purchase_request / reject_purchase_request RPCs via a
 *      service connection impersonating nothing — the RPC re-validates that
 *      the recipient is (still) head of the cost center;
 *    - mark the queue row 'actioned' and respond to Slack within 3 s.
 *
 * Until then: 501.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Integração Slack ainda não habilitada." },
    { status: 501 },
  );
}
