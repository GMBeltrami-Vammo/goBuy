import type { DocumentType, PaymentMethod, RequestStatus } from "@/lib/types";

// ─── Payment types (export column "Payment Type") ─────────────────────────────
export const PAYMENT_TYPES = [
  "PIX Transfêrencias",
  "Boleto Outros Bancos",
  "Boleto Itaú",
  "Multa",
  "Guia",
  "Dinheiro",
  "RH e Salários",
  "Câmbio",
  "DA",
] as const;

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  transfer: "Transferência bancária",
  boleto: "Boleto",
};

// ─── Currencies (default BRL) ─────────────────────────────────────────────────
// Keep the codes in sync with the currency CHECK in finance.submit_purchase_request.
export const CURRENCIES = [
  { code: "BRL", label: "R$ (Real)" },
  { code: "USD", label: "USD (Dólar Americano)" },
  { code: "EUR", label: "EUR (Euro)" },
  { code: "GBP", label: "GBP (Libra Esterlina)" },
  { code: "CNY", label: "CNY (Yuan / Renminbi)" },
  { code: "JPY", label: "JPY (Iene)" },
  { code: "MXN", label: "MXN (Peso Mexicano)" },
  { code: "ARS", label: "ARS (Peso Argentino)" },
] as const;

export const currencyLabel = (code: string): string =>
  CURRENCIES.find((c) => c.code === code)?.label ?? code;

export const formatAmount = (n: number, currency = "BRL"): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);

// ─── Document-type gating by status ───────────────────────────────────────────
// Enquanto pendente: apenas cotações e contratos.
// Aprovada em diante: nota fiscal, fatura, recibo, nota de débito, boleto, outros.
const PRE_APPROVAL_DOCS: DocumentType[] = ["quotation", "contract"];
const POST_APPROVAL_DOCS: DocumentType[] = [
  "nota_fiscal",
  "invoice",
  "receipt",
  "debit_note",
  "boleto",
  "other",
];

export function allowedDocTypes(status: RequestStatus): DocumentType[] {
  if (status === "pending") return PRE_APPROVAL_DOCS;
  if (status === "approved" || status === "awaiting_finance" || status === "awaiting_payment" || status === "paid") {
    return [...POST_APPROVAL_DOCS, ...PRE_APPROVAL_DOCS];
  }
  return []; // rejected / cancelled: no uploads
}

// ─── Expected payment date (terças e sextas, America/Sao_Paulo) ───────────────
// Enviadas segunda a quarta até 18h → pagamento na sexta da mesma semana
// Enviadas quinta a sexta até 18h → pagamento na terça da semana seguinte
// Após 18h conta como dia seguinte; fim de semana rola para segunda.
// Mirrors finance.compute_expected_payment_date in Postgres (the authority).
export function expectedPaymentDate(at: Date = new Date()): Date {
  // Brazil no longer observes DST: BRT is a fixed UTC-3.
  const brt = new Date(at.getTime() - 3 * 60 * 60 * 1000);
  let day = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate());
  const DAY = 24 * 60 * 60 * 1000;

  if (brt.getUTCHours() >= 18) day += DAY;

  let dow = new Date(day).getUTCDay(); // 0=dom … 6=sáb
  if (dow === 6) { day += 2 * DAY; dow = 1; }
  if (dow === 0) { day += DAY; dow = 1; }

  if (dow <= 3) {
    day += (5 - dow) * DAY; // sexta da mesma semana
  } else {
    day += (8 - dow + 1) * DAY; // terça da semana seguinte
  }
  return new Date(day);
}

export const formatDateBR = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
