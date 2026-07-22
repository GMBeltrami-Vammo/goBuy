export type RequestType = "products" | "service" | "advance";
export type RequestStatus =
  | "pending"
  | "approved"
  | "awaiting_finance"
  | "awaiting_payment"
  | "rejected"
  | "cancelled"
  | "paid";
export type DocumentType =
  | "nota_fiscal"
  | "quotation"
  | "invoice"
  | "receipt"
  | "contract"
  | "boleto"
  | "debit_note"
  | "other";
export type AppRole = "finance" | "fiscal" | "admin" | "reclassifier";
export type PaymentMethod = "pix" | "transfer" | "boleto";

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  department: string;
  active: boolean;
  cost_center_heads?: { head_name: string | null; head_email: string }[];
}

export interface CostCenterHead {
  cost_center_id: number;
  head_email: string;
  head_name: string | null;
}

export interface CostCenterBudget {
  id: number;
  cost_center_id: number;
  period_month: string;
  amount: number;
  source: string;
}

/** Normalized subset of the BrasilAPI CNPJ response (see /api/cnpj/[cnpj]). */
export interface CnpjLookup {
  cnpj: string; // 14 digits
  razao_social: string;
  nome_fantasia: string | null;
  situacao_cadastral: string; // e.g. "ATIVA"
  ativa: boolean;
  endereco: string | null; // one-line street address
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  cnae: string | null;
  natureza_juridica: string | null;
}

export interface Fornecedor {
  id: number;
  razao_social: string;
  document: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  pix_key: string | null;
  payment_default: "bank" | "pix" | null;
  default_cost_center_id: number | null;
  contract_storage_path: string | null;
  contract_filename: string | null;
  contract_content_type: string | null;
  contract_size_bytes: number | null;
  status: "pending" | "approved";
  active: boolean;
  created_by_email: string | null;
  created_at: string;
  approved_by_email: string | null;
  approved_at: string | null;
}

export interface PurchaseRequest {
  id: string;
  display_id: string;
  request_type: RequestType;
  status: RequestStatus;
  fornecedor_id: number;
  supplier_name: string;
  supplier_document: string | null;
  cost_center_id: number;
  requester_email: string;
  justification: string | null;
  notes: string | null;
  total_amount: number;
  currency: string;
  service_period: string | null;
  service_start: string | null;
  service_end: string | null;
  advance_purpose: string | null;
  advance_use_date: string | null;
  advance_settlement_deadline: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_email: string | null;
  decision_reason: string | null;
  cancelled_at: string | null;
  paid_at: string | null;
  paid_by_email: string | null;
  payment_reference: string | null;
  contracted_company: string | null;
  company: string | null;
  nf_number: string | null;
  payment_due_date: string | null;
  expected_payment_date: string | null;
  payment_method: PaymentMethod | null;
  pix_key: string | null;
  bank_name: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  payment_type: string | null;
  finance_submitted_at: string | null;
  cost_centers?: Pick<CostCenter, "code" | "name" | "department"> & {
    cost_center_heads?: { head_name: string | null; head_email: string }[];
  };
  request_allocations?: RequestAllocation[];
}

export interface RequestAllocation {
  id?: number;
  request_id?: string;
  cost_center_id: number;
  percentage: number;
  approved_at?: string | null;
  approved_by_email?: string | null;
  cost_centers?: Pick<CostCenter, "code" | "name" | "department">;
}

export interface RequestItem {
  id: number;
  request_id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_value: number;
  line_total: number;
}

export interface RequestDocument {
  id: string;
  request_id: string;
  doc_type: DocumentType;
  original_filename: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by_email: string;
  created_at: string;
}

export interface RequestEvent {
  id: number;
  request_id: string;
  event_type: string;
  actor_email: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface SessionContext {
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isHead: boolean;
  headCenterIds: number[];
  roles: AppRole[];
  /** Email is in the FULL_APP_ADMINS allowlist → may see the full (non-demo) app. */
  isFullAppAdmin: boolean;
  /** Has the reclassifier role → may assign new CCs to charges in reclassification. */
  isReclassifier: boolean;
  /** The RH approver → sees ONLY confidential "RH" charges and decides them. */
  isRhViewer: boolean;
  supabaseToken: string;
}

export interface IncomingCharge {
  id: string;
  display_id: string;
  supplier_name: string;
  nf_number: string | null;
  description: string | null;
  cost_center_id: number;
  cost_center_input: string | null;
  due_date: string | null;
  attachment_url: string | null;
  boleto_url: string | null;
  email: string | null;
  payment_method: string | null;
  pix_key: string | null;
  amount: number;
  currency: string;
  observation: string | null;
  sheet_name: string | null;
  sheet_row: number | null;
  status: "pending" | "approved" | "denied" | "reclassifying";
  request_date: string | null;
  is_rateio: boolean;
  reclassified_cc_code: string;
  original_cost_center_id: number | null;
  reclass_proposed_cc_id: number | null;
  reclass_requested_by: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_email: string | null;
  decision_reason: string | null;
  sheet_written_at: string | null;
  cost_centers?: Pick<CostCenter, "code" | "name" | "department">;
}
