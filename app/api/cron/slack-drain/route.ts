import { NextResponse } from "next/server";

import { drainChargeNotificationQueue } from "@/lib/charge-notify";

export const runtime = "nodejs";

/**
 * Drains the quiet-hours Slack queue: fires each still-queued charge
 * notification as its own One-Tap message. Scheduled by Vercel Cron at 12:00
 * UTC (09:00 BRT) — see vercel.json. Gated by CRON_SECRET; Vercel Cron sends it
 * as `Authorization: Bearer <CRON_SECRET>`. Fails closed if the secret isn't set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await drainChargeNotificationQueue();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/slack-drain] failed:", err);
    return NextResponse.json({ error: "Drain failed." }, { status: 500 });
  }
}
