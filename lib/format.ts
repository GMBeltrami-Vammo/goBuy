export const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Safe formatter for date-only fields (yyyy-mm-dd). Splits the string so
 *  it is never parsed as UTC midnight, avoiding a 1-day shift in BRT (UTC-3). */
export const formatDateOnlyBR = (ymd: string): string => {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
};

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * A timestamp's calendar date in São Paulo time, as "yyyy-mm-dd".
 * Budget months/days are local (BRT) calendar buckets, so spend created late in
 * the evening must be classified by its BRT date — not the raw UTC slice, which
 * would roll the last ~3h of a month into the next month.
 */
export const brtYmd = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** A timestamp in São Paulo time as "DD-MM-YYYY HH:MM" (24h) — the head-approval
 *  stamp sent to the sheet. Dashes in the date, colon in the time, by design. */
export const brtStamp = (iso: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}-${g("month")}-${g("year")} ${g("hour")}:${g("minute")}`;
};

// ─── dd/mm/yyyy date-filter helpers (shared by the dashboards) ────────────────

/** Auto-slash mask for dd/mm/yyyy filter inputs. */
export const maskDMY = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
};

/**
 * Parse dd/mm/yyyy → yyyy-mm-dd. Returns "" for incomplete or invalid input,
 * rejecting overflow dates (e.g. 31/02/2026) that Date would silently roll over.
 */
export const parseDMY = (s: string): string => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const mon = Number(mm);
  const year = Number(yyyy);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return "";
  const d = new Date(Date.UTC(year, mon - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mon - 1 || d.getUTCDate() !== day) {
    return "";
  }
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * True when a date field is fully typed (10 chars) but not a real date — used
 * to show inline validation feedback instead of failing silently.
 */
export const isInvalidDMY = (s: string): boolean => s.length === 10 && parseDMY(s) === "";

/** Progressive mask for a CNPJ input → "00.000.000/0000-00". */
export const maskCNPJ = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  let out = d.slice(0, 2);
  if (d.length > 2) out += "." + d.slice(2, 5);
  if (d.length > 5) out += "." + d.slice(5, 8);
  if (d.length > 8) out += "/" + d.slice(8, 12);
  if (d.length > 12) out += "-" + d.slice(12, 14);
  return out;
};

/** Strip everything but digits — e.g. a masked CNPJ back to its 14 digits. */
export const onlyDigits = (s: string): string => s.replace(/\D/g, "");

/**
 * Parse a Brazilian-formatted money string into a number.
 * Accepts "1234,56", "1.234,56", "1234.56", "1234", with an optional "R$"/spaces.
 * Comma is the decimal separator; a dot is treated as a thousands separator when
 * the digits are grouped (1.234.567), otherwise as a decimal point.
 * Returns null when the input is not a valid number.
 */
export const parseBRLDecimal = (input: unknown): number | null => {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", "."); // dots = thousands, comma = decimal
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // grouped dots = thousands (else keep as decimal point)
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  awaiting_finance: "Aguardando financeiro",
  awaiting_payment: "Aguardando pagamento",
  rejected: "Recusada",
  cancelled: "Cancelada",
  paid: "Paga",
};

// Compact labels for the inline status badge (the full labels overflow the
// tight dashboard row columns). Filters/dropdowns keep STATUS_LABEL.
export const STATUS_BADGE_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  awaiting_finance: "Ag. financeiro",
  awaiting_payment: "Ag. pagamento",
};

export const TYPE_LABEL: Record<string, string> = {
  products: "Produtos",
  service: "Serviço",
  advance: "Adiantamento",
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  nota_fiscal: "Nota fiscal",
  quotation: "Cotação",
  invoice: "Fatura",
  receipt: "Recibo",
  contract: "Contrato",
  boleto: "Boleto",
  debit_note: "Nota de débito",
  other: "Outro",
};

export const EVENT_LABEL: Record<string, string> = {
  created: "Solicitação criada",
  approved: "Aprovada",
  partial_approval: "Aprovação parcial — aguardando outros heads",
  rejected: "Recusada",
  cancelled: "Cancelada",
  paid: "Pagamento realizado",
  document_added: "Documento anexado",
  notification_queued: "Notificação ao head registrada",
  payment_info_submitted: "Dados de pagamento enviados",
  finance_confirmed: "Documentos validados pelo financeiro",
};
