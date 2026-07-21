import { brtStamp, formatDateOnlyBR } from "@/lib/format";

/**
 * Payment scheduling for approved charges (demo). A payment runs only on
 * Tuesdays or Fridays; on approval it's scheduled to the next Tuesday/Friday
 * that is at least one day after the approval date. The original due date is the
 * charge's Vencimento — when the scheduled date differs from it, the payment is
 * "reprogramado". Pure functions, shared by the write-back (server) and the
 * dashboard display (client) so both always agree.
 */

const TUE = 2;
const FRI = 5;

const toYmd = (dt: Date): string => {
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
};

/** Next Tuesday/Friday strictly at least one day after `approvalYmd` (yyyy-mm-dd). */
export function nextPaymentDate(approvalYmd: string): string {
  const [y, m, d] = approvalYmd.split("-").map(Number);
  // Operate on a pure calendar date via UTC to avoid any timezone drift.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1); // "at least one day from approval"
  for (let i = 0; i < 14; i++) {
    const wd = dt.getUTCDay();
    if (wd === TUE || wd === FRI) break;
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return toYmd(dt);
}

/**
 * Latest date the charge can still be approved without its payment slipping past
 * the cycle its due date warrants. The on-time payment is nextPaymentDate(due);
 * approving any later than the day before that payday pushes payment to a later
 * Tuesday/Friday. Because payments run only Tue/Fri, this is often a day or two
 * AFTER the Vencimento itself. Returns yyyy-mm-dd.
 */
export function lastSafeApprovalDate(dueYmd: string): string {
  const target = nextPaymentDate(dueYmd);
  const [y, m, d] = target.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return toYmd(dt);
}

export interface PaymentSchedule {
  /** yyyy-mm-dd of the scheduled payment. */
  newPaymentDate: string;
  /** True when the scheduled date differs from the original Vencimento. */
  rescheduled: boolean;
}

/**
 * Effective payment date: the LATER of the pay-day after approval and the
 * pay-day after the Vencimento — i.e. max(nextPaymentDate(approval),
 * nextPaymentDate(vencimento)). This means a charge is never paid before the
 * Tuesday/Friday cycle following its due date, nor before the cycle following
 * approval (overdue charges pay on the next cycle after approval). ISO
 * yyyy-mm-dd strings compare correctly with `>`.
 */
export function effectivePaymentDate(approvalYmd: string, dueYmd: string | null): string {
  const fromApproval = nextPaymentDate(approvalYmd);
  if (!dueYmd) return fromApproval;
  const fromDue = nextPaymentDate(dueYmd);
  return fromDue > fromApproval ? fromDue : fromApproval;
}

export function paymentSchedule(approvalYmd: string, dueYmd: string | null): PaymentSchedule {
  const newPaymentDate = effectivePaymentDate(approvalYmd, dueYmd);
  return { newPaymentDate, rescheduled: !!dueYmd && dueYmd !== newPaymentDate };
}

/**
 * The `head_approval_time` string sent to the sheet, e.g.
 *   "21-07-2026 14:30 - Pagamento reprogramado de 18/07/2026 para 23/07/2026."
 *   "21-07-2026 14:30 - Pagamento para 23/07/2026."
 */
export function headApprovalTimeString(
  approvalIso: string,
  dueYmd: string | null,
  newPaymentYmd: string,
  rescheduled: boolean,
): string {
  const stamp = brtStamp(approvalIso);
  return rescheduled && dueYmd
    ? `${stamp} - Pagamento reprogramado de ${formatDateOnlyBR(dueYmd)} para ${formatDateOnlyBR(newPaymentYmd)}.`
    : `${stamp} - Pagamento para ${formatDateOnlyBR(newPaymentYmd)}.`;
}
