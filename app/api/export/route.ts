import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth";
import { isSameOriginFetch } from "@/lib/http";
import { currencyLabel } from "@/lib/payment";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Links no export precisam ser permanentes (a planilha vive fora do app).
// O bucket continua privado; usamos signed URLs de 10 anos.
const SIGNED_URL_TTL = 10 * 365 * 24 * 60 * 60;

const HEADERS = [
  "Data Solicitação",      // A
  "Payment Type",          // B
  "Fornecedor",            // C
  "Valor",                 // D
  "NF",                    // E
  "Descrição",             // F
  "Data do pagamento",     // G
  "Departamento",          // H
  "Classe",                // I
  "Comentários",           // J
  "Status",                // K
  "Link da NF",            // L
  "Endereço de e-mail",    // M
  "Boleto",                // N
  "Observação",            // O
  "Houve desconto na fatura? Se sim, informe abaixo.", // P
  "O pagamento será de qual empresa?",                 // Q
  "Qual a moeda?",                                     // R
];

interface ExportRow {
  id: string;
  display_id: string;
  request_type: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  company: string | null;
  justification: string | null;
  requester_email: string;
  nf_number: string | null;
  payment_type: string | null;
  expected_payment_date: string | null;
  finance_submitted_at: string | null;
  request_allocations: {
    percentage: number;
    cost_centers: { code: string; name: string; department: string } | null;
  }[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** dd/mm/YYYY HH:MM:SS em horário de Brasília (UTC-3 fixo). */
function formatTimestampBRT(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Date-only string (yyyy-mm-dd) → dd/mm/yyyy. */
function formatDateOnly(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/** Valor no formato DD.DDD,DD — sem símbolo de moeda. */
function formatValor(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function nfColumn(row: ExportRow): string {
  if (row.nf_number) return row.nf_number;
  if (row.request_type === "advance") return "Adiantamento";
  return "Outros";
}

function departmentColumn(row: ExportRow): string {
  const allocs = row.request_allocations.filter((a) => a.cost_centers);
  if (allocs.length === 0) return "";
  const fmt = (a: ExportRow["request_allocations"][number]) =>
    `${a.cost_centers!.code}: ${a.cost_centers!.department}: ${a.cost_centers!.name}`;
  if (allocs.length === 1) return fmt(allocs[0]);
  return allocs
    .map((a) => `${Number(a.percentage) % 1 === 0 ? Number(a.percentage) : Number(a.percentage).toFixed(2)}%: ${fmt(a)}`)
    .join("\n");
}

/** Folha por mês de pagamento esperado: "04-2026". */
function sheetKey(expected: string | null): string {
  if (!expected) return "sem-data";
  const [y, m] = expected.split("-");
  return `${m}-${y}`;
}

export async function GET(request: Request) {
  // This endpoint is only ever called via our own fetch(); requiring a
  // same-origin fetch blocks cross-site GET navigation (SameSite=Lax would
  // otherwise still send the session cookie on a top-level cross-site GET).
  if (!isSameOriginFetch(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const canFinance = ctx.roles.includes("finance") || ctx.roles.includes("admin");
  if (!canFinance) {
    return NextResponse.json({ error: "Apenas o financeiro pode exportar." }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("purchase_requests")
    .select(
      `id, display_id, request_type, supplier_name,
       total_amount, currency, company, justification, requester_email, nf_number,
       payment_type, expected_payment_date, finance_submitted_at,
       request_allocations(percentage, cost_centers(code, name, department))`,
    )
    .eq("status", "awaiting_payment")
    .order("expected_payment_date", { ascending: true });

  if (error) {
    console.error("[export] query failed:", error.message);
    return NextResponse.json({ error: "Erro ao consultar solicitações." }, { status: 500 });
  }

  const rows = (data as unknown as ExportRow[]) ?? [];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma solicitação em aguardando pagamento." },
      { status: 404 },
    );
  }

  // Latest nota_fiscal + boleto document per request, with long-lived links.
  const { data: docs } = await admin
    .from("request_documents")
    .select("request_id, doc_type, storage_path, created_at")
    .in("request_id", rows.map((r) => r.id))
    .in("doc_type", ["nota_fiscal", "boleto"])
    .order("created_at", { ascending: true });

  const docPath = new Map<string, string>(); // `${request_id}:${doc_type}` → latest path
  for (const d of (docs ?? []) as { request_id: string; doc_type: string; storage_path: string }[]) {
    docPath.set(`${d.request_id}:${d.doc_type}`, d.storage_path);
  }

  // Sign every distinct document path in ONE batch request rather than two
  // sequential round-trips per row (which would be ~2N serial calls and risk a
  // function timeout on large exports).
  const linkByPath = new Map<string, string>();
  const allPaths = [...new Set(docPath.values())];
  if (allPaths.length > 0) {
    const { data: signed } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls(allPaths, SIGNED_URL_TTL);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) linkByPath.set(s.path, s.signedUrl);
    }
  }
  const linkFor = (path: string | undefined): string =>
    path ? linkByPath.get(path) ?? "" : "";

  // Group by expected payment month, chronologically ordered sheets.
  const groups = new Map<string, ExportRow[]>();
  for (const row of rows) {
    const key = sheetKey(row.expected_payment_date);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (a === "sem-data") return 1;
    if (b === "sem-data") return -1;
    const [ma, ya] = a.split("-").map(Number);
    const [mb, yb] = b.split("-").map(Number);
    return ya - yb || ma - mb;
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Lumen";

  for (const key of orderedKeys) {
    const sheet = workbook.addWorksheet(key);
    const headerRow = sheet.addRow(HEADERS);
    headerRow.font = { bold: true };

    for (const row of groups.get(key)!) {
      const nfLink = linkFor(docPath.get(`${row.id}:nota_fiscal`));
      const boletoLink = linkFor(docPath.get(`${row.id}:boleto`));

      sheet.addRow([
        row.finance_submitted_at ? formatTimestampBRT(row.finance_submitted_at) : "",
        row.payment_type ?? "",
        row.supplier_name,
        formatValor(Number(row.total_amount)),
        nfColumn(row),
        row.justification ?? "",
        row.expected_payment_date ? formatDateOnly(row.expected_payment_date) : "",
        departmentColumn(row),
        null, // Classe
        null, // Comentários
        "Lançamento - Lumen",
        nfLink,
        row.requester_email,
        boletoLink,          // N
        null,                // O – Observação (blank/manual)
        null,                // P – Desconto (blank/manual)
        row.company ?? "Vammo Brasil", // Q – Empresa
        currencyLabel(row.currency || "BRL"), // R – Moeda
      ]);
    }

    sheet.columns.forEach((col, i) => {
      col.width = [20, 22, 30, 14, 16, 40, 16, 40, 10, 14, 18, 50, 30, 50, 14, 36, 32, 22][i] ?? 14;
    });
    // Departamento (col 8) holds one rateio line per allocation — wrap so the
    // \n separators render as multiple lines within the single row.
    sheet.getColumn(8).alignment = { wrapText: true, vertical: "top" };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="lumen-pagamentos-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
