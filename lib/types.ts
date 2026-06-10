export type RequestType = "products" | "service" | "advance";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "paid";
export type DocumentType = "nota_fiscal" | "quotation" | "invoice" | "receipt" | "contract" | "other";
export type AppRole = "finance" | "fiscal" | "admin";

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  department: string;
  active: boolean;
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

export interface PurchaseRequest {
  id: string;
  display_id: string;
  request_type: RequestType;
  status: RequestStatus;
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
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isHead: boolean;
  headCenterIds: number[];
  roles: AppRole[];
}
