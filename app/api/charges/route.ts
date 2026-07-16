import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { parseBRLDecimal, parseDMY } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Constant-time bearer-secret check. Fails closed if the secret isn't set. */
function bearerOk(request: Request): boolean {
  const secret = process.env.CHARGES_INBOUND_SECRET;
  if (!secret) return false;
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Trim a nullable string field to null when empty. */
function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/**
 * Resolve a cost-center identifier: accept the code ("1001", "1605.01") or the
 * full class string ("1001: Marketing: Payroll") — take the token before ':'.
 */
function ccCode(input: string): string {
  return input.split(":")[0].trim();
}

interface ChargePayload {
  supplier_name?: string;
  nf_number?: string;
  description?: string;
  cost_center?: string;
  due_date?: string;
  attachment_url?: string;
  email?: string;
  payment_method?: string;
  boleto_url?: string;
  pix_key?: string;
  amount?: string | number;
  observation?: string;
  sheet?: string;
  row?: number | string;
}

export async function POST(request: Request) {
  if (!bearerOk(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: ChargePayload;
  try {
    body = (await request.json()) as ChargePayload;
  } catch {
    return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  }

  const supplier_name = String(body.supplier_name ?? "").trim();
  const ccInput = String(body.cost_center ?? "").trim();
  if (!supplier_name || body.amount === undefined || body.amount === null || !ccInput) {
    return NextResponse.json(
      { error: "supplier_name, amount and cost_center are required." },
      { status: 400 },
    );
  }

  const amount = parseBRLDecimal(body.amount);
  if (amount === null || amount < 0) {
    return NextResponse.json({ error: "Invalid amount." }, { status: 422 });
  }

  const admin = supabaseAdmin();
  const code = ccCode(ccInput);
  const { data: cc, error: ccErr } = await admin
    .from("cost_centers")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (ccErr) {
    console.error("[api/charges] cost_center lookup failed:", ccErr.message);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
  if (!cc) {
    return NextResponse.json(
      { error: "Unknown cost center.", unknown_cost_center: code },
      { status: 422 },
    );
  }

  // due_date: accept ISO (yyyy-mm-dd) or Brazilian dd/mm/yyyy.
  let due_date: string | null = null;
  const rawDue = String(body.due_date ?? "").trim();
  if (rawDue) {
    due_date = /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? rawDue : parseDMY(rawDue) || null;
  }

  let sheet_row: number | null = null;
  if (body.row !== undefined && body.row !== null && String(body.row).trim() !== "") {
    const n = Number.parseInt(String(body.row), 10);
    sheet_row = Number.isFinite(n) ? n : null;
  }

  // Upsert with ON CONFLICT DO NOTHING on (sheet_name, sheet_row): a re-sent
  // source row is skipped rather than duplicated. On a skip, PostgREST returns
  // no row → we report success (200) so the sender treats it as done.
  const { data: created, error: insErr } = await admin
    .from("incoming_charges")
    .upsert(
      {
        supplier_name,
        nf_number: str(body.nf_number),
        description: str(body.description),
        cost_center_id: cc.id,
        cost_center_input: ccInput,
        due_date,
        attachment_url: str(body.attachment_url),
        boleto_url: str(body.boleto_url),
        email: str(body.email),
        payment_method: str(body.payment_method),
        pix_key: str(body.pix_key),
        amount,
        observation: str(body.observation),
        sheet_name: str(body.sheet),
        sheet_row,
      },
      { onConflict: "sheet_name,sheet_row", ignoreDuplicates: true },
    )
    .select("id, display_id, status")
    .maybeSingle();

  if (insErr) {
    console.error("[api/charges] insert failed:", insErr.message);
    return NextResponse.json({ error: "Could not create charge." }, { status: 500 });
  }

  if (!created) {
    return NextResponse.json({ skipped: true, reason: "duplicate row" }, { status: 200 });
  }

  return NextResponse.json(created, { status: 201 });
}
