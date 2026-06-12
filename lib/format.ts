export const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  awaiting_finance: "Aguardando financeiro",
  awaiting_payment: "Aguardando pagamento",
  rejected: "Recusada",
  cancelled: "Cancelada",
  paid: "Paga",
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
  rejected: "Recusada",
  cancelled: "Cancelada",
  paid: "Pagamento realizado",
  document_added: "Documento anexado",
  notification_queued: "Notificação ao head registrada",
  payment_info_submitted: "Dados de pagamento enviados",
  finance_confirmed: "Documentos validados pelo financeiro",
};
