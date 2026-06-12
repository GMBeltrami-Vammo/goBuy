import { STATUS_BADGE_LABEL, TYPE_LABEL } from "@/lib/format";
import type { RequestStatus, RequestType } from "@/lib/types";

const STATUS_VAR: Record<RequestStatus, string> = {
  pending: "pending",
  approved: "approved",
  awaiting_finance: "awaiting-finance",
  awaiting_payment: "awaiting-payment",
  rejected: "rejected",
  cancelled: "cancelled",
  paid: "paid",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const v = STATUS_VAR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color: `var(--${v})`, background: `var(--${v}-soft)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--${v})` }} />
      {STATUS_BADGE_LABEL[status]}
    </span>
  );
}

export function TypeBadge({ type }: { type: RequestType }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--muted)]">
      {TYPE_LABEL[type]}
    </span>
  );
}
