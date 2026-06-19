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
