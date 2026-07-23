import { brtStamp, formatDateOnlyBR } from "@/lib/format";

/**
 * Payment-date orchestration (demo). The source system sends the intended
 * PAYMENT date via the API (stored in incoming_charges.due_date). Payments only
 * run on Tuesdays and Fridays, so:
 *   - paymentDate = that date if it already falls on a Tue/Fri, else the NEXT
 *     Tue/Fri after it (snapToPayDay);
 *   - vencimento (the "aprovar até" deadline) = paymentDate − 1 day.
 * The schedule is deterministic from the API date — it does NOT depend on the
 * approval date. Pure functions, shared by the write-back (server) and the
 * dashboard display (client) so both always agree.
 */

const TUE = 2;
const FRI = 5;

const toYmd = (dt: Date): string => {
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
};

/** The API date snapped to a payment day: kept as-is when it already falls on a
 *  Tuesday/Friday, otherwise moved forward to the next Tuesday/Friday. */
export function snapToPayDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 7; i++) {
    const wd = dt.getUTCDay();
    if (wd === TUE || wd === FRI) break;
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return toYmd(dt);
}

/** The calendar day before `ymd` (yyyy-mm-dd). */
export function dayBefore(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return toYmd(dt);
}

export interface PaymentSchedule {
  /** The raw date received from the API (the requested payment date). */
  apiDate: string | null;
  /** Payment date — the API date snapped to a Tuesday/Friday. */
  paymentDate: string | null;
  /** Vencimento / "aprovar até" — the day before the payment date. */
  vencimento: string | null;
  /** True when the API date wasn't a Tue/Fri and was moved to the next one. */
  adjusted: boolean;
}

/** Orchestrate the dates from the API-provided payment date. */
export function paymentSchedule(apiYmd: string | null): PaymentSchedule {
  if (!apiYmd) return { apiDate: null, paymentDate: null, vencimento: null, adjusted: false };
  const paymentDate = snapToPayDay(apiYmd);
  return { apiDate: apiYmd, paymentDate, vencimento: dayBefore(paymentDate), adjusted: paymentDate !== apiYmd };
}

/**
 * The `head_approval_time` string sent to the sheet on approval, e.g.
 *   "21-07-2026 14:30 - Pagamento reprogramado de 22/07/2026 para 24/07/2026."
 *   "21-07-2026 14:30 - Pagamento para 24/07/2026."
 * "reprogramado" is used when the API date had to be moved to a pay-day.
 */
export function headApprovalTimeString(
  approvalIso: string,
  apiYmd: string | null,
  paymentYmd: string,
  adjusted: boolean,
): string {
  const stamp = brtStamp(approvalIso);
  return adjusted && apiYmd
    ? `${stamp} - Pagamento reprogramado de ${formatDateOnlyBR(apiYmd)} para ${formatDateOnlyBR(paymentYmd)}.`
    : `${stamp} - Pagamento para ${formatDateOnlyBR(paymentYmd)}.`;
}
