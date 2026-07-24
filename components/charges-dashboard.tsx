"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ChargeDetailModal } from "@/components/charge-detail-modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FeriasDialog } from "@/components/ferias-dialog";
import { Pagination, usePagination } from "@/components/pagination";
import { RateioLine } from "@/components/rateio-line";
import { FilterHeader, type FilterOption } from "@/components/table-filter";
import { useSort } from "@/components/table-sort";
import { chargeContributions } from "@/lib/rateio";
import { brtDateTimeBR, brtYmd, formatBRL, formatDateOnlyBR } from "@/lib/format";
import { dayBefore, paymentSchedule, snapToPayDay } from "@/lib/payment-schedule";
import { formatAmount } from "@/lib/payment";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, CostCenterBudget, IncomingCharge } from "@/lib/types";

// recharts is heavy — load the budget visuals only when this dashboard renders.
const BudgetDonut = dynamic(
  () => import("@/components/budget-donut").then((m) => m.BudgetDonut),
  { ssr: false, loading: () => <div className="h-36 w-36 animate-pulse rounded-full bg-[var(--surface-2)]" /> },
);
const HeadAggregateChart = dynamic(
  () => import("@/components/head-aggregate-chart").then((m) => m.HeadAggregateChart),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-xl bg-[var(--surface-2)]" /> },
);

// A charge consumes budget while approved OR pending (pending = "at risk",
// firms up on approval). Denied never consumes.
const COMMITTED_STATUSES = new Set<IncomingCharge["status"]>(["approved", "pending", "reclassifying"]);

type ChargeStatus = IncomingCharge["status"];

const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  denied: "Recusada",
  reclassifying: "Em mudança de CC",
};
const CHARGE_STATUS_TONE: Record<ChargeStatus, string> = {
  pending: "pending",
  approved: "approved",
  denied: "rejected",
  reclassifying: "pending",
};
// Sort rank so the Status column orders sensibly (actionable first).
const STATUS_RANK: Record<ChargeStatus, number> = { pending: 0, reclassifying: 1, approved: 2, denied: 3 };
// Status values, in display order (for the Status column's value filter).
const STATUS_OPTIONS: { value: ChargeStatus; label: string }[] = [
  { value: "pending", label: "Pendente" },
  { value: "reclassifying", label: "Em mudança de CC" },
  { value: "approved", label: "Aprovada" },
  { value: "denied", label: "Recusada" },
];
// Default view = the decision queue: Status column starts with approved+denied
// UNCHECKED (excluded), so only Pendente + Em mudança de CC show.
const DEFAULT_EXCLUDED_STATUS: ChargeStatus[] = ["approved", "denied"];
const makeDefaultExcluded = (): Record<string, Set<string>> => ({
  status: new Set<string>(DEFAULT_EXCLUDED_STATUS),
});

function ChargeStatusBadge({ status }: { status: ChargeStatus }) {
  const tone = CHARGE_STATUS_TONE[status];
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 v-tabular text-[11px] font-semibold"
      style={{ color: `var(--${tone})`, backgroundColor: `var(--${tone}-soft)` }}
    >
      {CHARGE_STATUS_LABEL[status]}
    </span>
  );
}

// A charge amount in its own currency: BRL via the pt-BR real formatter, others
// via Intl (falls back to "<CODE> <n>" if Intl rejects an unusual code).
function fmtMoney(n: number, currency: string): string {
  if (!currency || currency === "BRL") return formatBRL(n);
  try {
    return formatAmount(n, currency);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

// ─── Sorting & search ─────────────────────────────────────────────────────────
type SortField = "id" | "request" | "supplier" | "cc" | "due" | "payment" | "amount" | "status";

function chargeSortKey(c: IncomingCharge, field: SortField): string | number {
  switch (field) {
    case "id":
      return c.display_id ?? "";
    case "request":
      return c.request_date ?? "";
    case "supplier":
      return (c.supplier_name ?? "").toLowerCase();
    case "cc":
      return c.cost_centers?.code ?? "";
    case "due":
      return paymentSchedule(c.due_date).vencimento ?? "";
    case "payment":
      return paymentSchedule(c.due_date).paymentDate ?? "";
    case "amount":
      return Number(c.amount) || 0;
    case "status":
      return STATUS_RANK[c.status];
  }
}

function compareCharges(a: IncomingCharge, b: IncomingCharge, field: SortField, dir: "asc" | "desc"): number {
  const ka = chargeSortKey(a, field);
  const kb = chargeSortKey(b, field);
  const aEmpty = ka === "";
  const bEmpty = kb === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp =
    typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
  return dir === "asc" ? cmp : -cmp;
}

// Free-text match across the fields shown in the row.
function matchesChargeSearch(c: IncomingCharge, q: string): boolean {
  return [c.display_id, c.supplier_name, c.nf_number, c.description, c.observation, c.cost_centers?.code, c.cost_centers?.name]
    .some((v) => (v ?? "").toString().toLowerCase().includes(q));
}

export function ChargesDashboard({
  email,
  supabaseToken,
  centerIds,
  allCostCenters,
  isRhViewer,
  canDelegate,
}: {
  email: string;
  supabaseToken: string;
  centerIds: number[];
  /** All active cost centers — for proposing a target CC when reclassifying. */
  allCostCenters: Pick<CostCenter, "id" | "code" | "name" | "department">[];
  /** The RH approver — gets the Slack toggle even though they head no CC. */
  isRhViewer: boolean;
  /** Heads + admins see the delegate button (admins delegate but transfer nothing). */
  canDelegate: boolean;
}) {
  const [charges, setCharges] = useState<IncomingCharge[] | null>(null);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [budgets, setBudgets] = useState<CostCenterBudget[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  // Per-row in-flight ids (not a single global lock) so decisions on different
  // rows can run concurrently and never block each other.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [denyTarget, setDenyTarget] = useState<IncomingCharge | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [viewMode, setViewMode] = useState<"pizza" | "barra">("pizza");
  const [detailCc, setDetailCc] = useState<CostCenter | null>(null);
  // Budget-graph CC scope (separate from the table's per-column filters).
  const [selectedCcs, setSelectedCcs] = useState<Set<number>>(new Set());
  // Table controls: global search + per-column value filters (excluded = unchecked
  // values) + column sort.
  const [search, setSearch] = useState("");
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>(makeDefaultExcluded);
  const { field: sortField, dir: sortDir, setSort } = useSort<SortField>("due", "asc");
  // Per-head Slack notification preference (null = still loading; default off).
  const [slackOn, setSlackOn] = useState<boolean | null>(null);
  const [slackBusy, setSlackBusy] = useState(false);
  // Reclassification request modal (head → proposes an optional target CC).
  const [reclassTarget, setReclassTarget] = useState<IncomingCharge | null>(null);
  const [reclassProposedCc, setReclassProposedCc] = useState("");
  // Delegar aprovação (Ausência) — hand approvals to a substitute for a window.
  const [feriasOpen, setFeriasOpen] = useState(false);
  const queueRef = useRef<HTMLDivElement>(null);

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  }, []);
  const [selectedMonth, setSelectedMonth] = useState(monthStart);

  const hasCenters = centerIds.length > 0;
  // Heads and the RH approver may toggle their Slack notifications.
  const canSlack = hasCenters || isRhViewer;
  // Today's BRT calendar date — a Vencimento before it is overdue.
  const todayYmd = brtYmd(new Date().toISOString());

  const addDaysYmd = (ymd: string, n: number) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };
  // Payment/vencimento for display. An UNSETTLED charge whose payment day is
  // today or already past rolls to the next window (next Tue/Fri after today);
  // the original is kept (shown struck in red) so the move is visible.
  const displaySchedule = (c: IncomingCharge) => {
    const base = paymentSchedule(c.due_date);
    const settled = c.status === "approved" || c.status === "denied";
    if (!settled && base.paymentDate && base.paymentDate <= todayYmd) {
      const newPay = snapToPayDay(addDaysYmd(todayYmd, 1));
      return { paymentDate: newPay, vencimento: dayBefore(newPay), rolled: true, prevPayment: base.paymentDate, prevVenc: base.vencimento };
    }
    return { paymentDate: base.paymentDate, vencimento: base.vencimento, rolled: false, prevPayment: null as string | null, prevVenc: null as string | null };
  };

  const load = useCallback(async () => {
    const supabase = supabaseBrowser(supabaseToken);
    const [chargeRes, ccRes, budgetRes] = await Promise.all([
      supabase
        .from("incoming_charges")
        .select("*, cost_centers!incoming_charges_cost_center_id_fkey(code, name, department)")
        .order("due_date", { ascending: true })
        .limit(500),
      hasCenters
        ? supabase.from("cost_centers").select("id, code, name, department, active").in("id", centerIds)
        : Promise.resolve({ data: [] }),
      hasCenters
        ? supabase
            .from("cost_center_budgets")
            .select("id, cost_center_id, period_month, amount, source")
            .in("cost_center_id", centerIds)
        : Promise.resolve({ data: [] }),
    ]);
    setCharges((chargeRes.data as unknown as IncomingCharge[]) ?? []);
    setCenters((ccRes.data as unknown as CostCenter[]) ?? []);
    setBudgets((budgetRes.data as unknown as CostCenterBudget[]) ?? []);
  }, [supabaseToken, centerIds, hasCenters]);

  useEffect(() => {
    void load();
  }, [load]);

  // The budget CC multi-select scopes the graphs (not the table). Empty = all.
  const isVisible = (id: number) => selectedCcs.size === 0 || selectedCcs.has(id);
  const selKey = [...selectedCcs].sort((a, b) => a - b).join(",");

  // ─── Budget aggregation (committed = approved + pending BRL, by due date) ──────
  const ym = (d: string) => d.slice(0, 7); // "yyyy-mm"

  const codeToId = useMemo(() => new Map(centers.map((c) => [c.code, c.id])), [centers]);

  const committedByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of charges ?? []) {
      if (!COMMITTED_STATUSES.has(c.status) || !c.due_date) continue;
      if ((c.currency ?? "BRL") !== "BRL") continue; // budgets are in BRL — no FX
      if (ym(c.due_date) !== ym(selectedMonth)) continue;
      for (const { id, amount } of chargeContributions(c, codeToId)) {
        map.set(id, (map.get(id) ?? 0) + amount);
      }
    }
    return map;
  }, [charges, selectedMonth, codeToId]);

  const pendingAmountByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of charges ?? []) {
      if (c.status !== "pending" || !c.due_date) continue;
      if ((c.currency ?? "BRL") !== "BRL") continue;
      if (ym(c.due_date) !== ym(selectedMonth)) continue;
      for (const { id, amount } of chargeContributions(c, codeToId)) {
        map.set(id, (map.get(id) ?? 0) + amount);
      }
    }
    return map;
  }, [charges, selectedMonth, codeToId]);

  const foreignThisMonth = useMemo(
    () =>
      (charges ?? []).filter(
        (c) =>
          COMMITTED_STATUSES.has(c.status) &&
          !!c.due_date &&
          ym(c.due_date) === ym(selectedMonth) &&
          (c.currency ?? "BRL") !== "BRL" &&
          isVisible(c.cost_center_id),
      ).length,
    [charges, selectedMonth, selKey],
  );

  const budgetByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of budgets) {
      if (b.period_month.slice(0, 10) === selectedMonth) map.set(b.cost_center_id, Number(b.amount));
    }
    return map;
  }, [budgets, selectedMonth]);

  const totals = useMemo(() => {
    const visible = centers.filter((c) => isVisible(c.id));
    const budget = visible.reduce((a, c) => a + (budgetByCenter.get(c.id) ?? 0), 0);
    const committed = visible.reduce((a, c) => a + (committedByCenter.get(c.id) ?? 0), 0);
    const pending = visible.reduce((a, c) => a + (pendingAmountByCenter.get(c.id) ?? 0), 0);
    return { budget, committed, pending, available: Math.max(0, budget - committed) };
  }, [centers, budgetByCenter, committedByCenter, pendingAmountByCenter, selKey]);

  const relevantCenters = useMemo(
    () =>
      centers.filter(
        (c) => isVisible(c.id) && ((budgetByCenter.get(c.id) ?? 0) > 0 || (committedByCenter.get(c.id) ?? 0) > 0),
      ),
    [centers, budgetByCenter, committedByCenter, selKey],
  );

  const aggregateData = useMemo(
    () =>
      relevantCenters.map((cc) => ({
        cc,
        committed: committedByCenter.get(cc.id) ?? 0,
        budget: budgetByCenter.get(cc.id) ?? 0,
      })),
    [relevantCenters, committedByCenter, budgetByCenter],
  );

  const filterableCenters = useMemo(() => {
    const withCharges = new Set((charges ?? []).map((c) => c.cost_center_id));
    return centers.filter((c) => withCharges.has(c.id)).sort((a, b) => a.code.localeCompare(b.code));
  }, [centers, charges]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>(budgets.map((b) => b.period_month.slice(0, 10)));
    for (const c of charges ?? []) if (c.due_date) set.add(`${ym(c.due_date)}-01`);
    set.add(monthStart);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [budgets, charges, monthStart]);

  const monthName = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const isMockOrEmpty = hasCenters && budgets.length === 0;

  // ─── Single charge table — per-column value filters + sort + global search ────
  const searchQ = search.trim().toLowerCase();

  // Distinct values present, for each filterable column's dropdown.
  const filterOptions = useMemo(() => {
    const supplier = new Map<string, string>();
    const cc = new Map<string, string>();
    const venc = new Map<string, string>();
    const payment = new Map<string, string>();
    for (const c of charges ?? []) {
      supplier.set(c.supplier_name ?? "", c.supplier_name ?? "");
      const code = c.cost_centers?.code ?? "";
      cc.set(code, c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : code);
      const s = paymentSchedule(c.due_date);
      venc.set(s.vencimento ?? "", s.vencimento ? formatDateOnlyBR(s.vencimento) : "");
      payment.set(s.paymentDate ?? "", s.paymentDate ? formatDateOnlyBR(s.paymentDate) : "");
    }
    // Blanks last; otherwise text by label, dates by value (chronological).
    const byLabel = (m: Map<string, string>): FilterOption[] =>
      [...m.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => (a.value === "" ? 1 : b.value === "" ? -1 : a.label.localeCompare(b.label)));
    const byDate = (m: Map<string, string>): FilterOption[] =>
      [...m.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => (a.value === "" ? 1 : b.value === "" ? -1 : a.value.localeCompare(b.value)));
    const status: FilterOption[] = STATUS_OPTIONS.filter((o) =>
      (charges ?? []).some((c) => c.status === o.value),
    ).map((o) => ({ value: o.value, label: o.label }));
    return { supplier: byLabel(supplier), cc: byLabel(cc), venc: byDate(venc), payment: byDate(payment), status };
  }, [charges]);

  const rows = useMemo(() => {
    const list = (charges ?? []).filter((c) => {
      if (searchQ && !matchesChargeSearch(c, searchQ)) return false;
      if (excluded.supplier?.has(c.supplier_name ?? "")) return false;
      if (excluded.cc?.has(c.cost_centers?.code ?? "")) return false;
      const s = paymentSchedule(c.due_date);
      if (excluded.venc?.has(s.vencimento ?? "")) return false;
      if (excluded.payment?.has(s.paymentDate ?? "")) return false;
      if (excluded.status?.has(c.status)) return false;
      return true;
    });
    return [...list].sort((a, b) => compareCharges(a, b, sortField, sortDir));
  }, [charges, excluded, searchQ, sortField, sortDir]);

  const excludedKey = Object.entries(excluded)
    .map(([k, s]) => `${k}:${[...s].sort().join("|")}`)
    .sort()
    .join(";");
  const pager = usePagination(rows, `charges|${excludedKey}|${searchQ}|${sortField}|${sortDir}`);

  // Actionable backlog (pending + in reclassification), for the jump button.
  const actionableCount = useMemo(
    () => (charges ?? []).filter((c) => c.status === "pending" || c.status === "reclassifying").length,
    [charges],
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  // Per-column value-filter handlers (excluded = the unchecked values).
  const toggleVal = (key: string, v: string) =>
    setExcluded((prev) => {
      const s = new Set(prev[key] ?? []);
      if (s.has(v)) s.delete(v);
      else s.add(v);
      return { ...prev, [key]: s };
    });
  const selectAllVals = (key: string) => setExcluded((prev) => ({ ...prev, [key]: new Set() }));
  const clearVals = (key: string, opts: FilterOption[]) =>
    setExcluded((prev) => ({ ...prev, [key]: new Set(opts.map((o) => o.value)) }));

  const isStatusDefault =
    excluded.status?.size === DEFAULT_EXCLUDED_STATUS.length &&
    DEFAULT_EXCLUDED_STATUS.every((s) => excluded.status?.has(s));
  const anyTableFilter =
    !!searchQ ||
    !isStatusDefault ||
    ["supplier", "cc", "venc", "payment"].some((k) => (excluded[k]?.size ?? 0) > 0);
  const clearFilters = () => {
    setSearch("");
    setExcluded(makeDefaultExcluded());
  };

  // Decide via the API route (not the RPC directly): the route runs the
  // Google-Sheet write-back inline on approval and returns its outcome.
  const decide = async (
    chargeId: string,
    action: "approve" | "deny",
    reason?: string,
  ): Promise<{ ok: boolean; sheetFailed: boolean }> => {
    try {
      const res = await fetch(`/api/charges/${chargeId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) return { ok: false, sheetFailed: false };
      const body = (await res.json().catch(() => ({}))) as { sheet?: { ok: boolean } };
      return { ok: true, sheetFailed: body.sheet?.ok === false };
    } catch {
      return { ok: false, sheetFailed: false };
    }
  };

  // Optimistic decision: update the UI instantly and run the server call in the
  // background; roll the row back on failure.
  const decideOptimistic = (c: IncomingCharge, action: "approve" | "deny", reason?: string) => {
    if (busyIds.has(c.id)) return;
    const snapshot = c;
    setBusyIds((prev) => new Set(prev).add(c.id));
    setCharges((prev) =>
      prev?.map((x) =>
        x.id === c.id
          ? {
              ...x,
              status: action === "approve" ? "approved" : "denied",
              decided_at: new Date().toISOString(),
              decided_by_email: email,
              decision_reason: action === "deny" ? (reason ?? null) : null,
            }
          : x,
      ) ?? prev,
    );

    void (async () => {
      const { ok, sheetFailed } = await decide(c.id, action, reason);
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
      if (!ok) {
        setCharges((prev) => prev?.map((x) => (x.id === c.id ? snapshot : x)) ?? prev);
        flash(
          action === "approve"
            ? `Não foi possível aprovar ${c.display_id}. Tente novamente.`
            : `Não foi possível recusar ${c.display_id}. Tente novamente.`,
        );
        return;
      }
      const note = sheetFailed ? " (planilha não confirmada — verifique a integração)" : "";
      flash(`${c.display_id} ${action === "approve" ? "aprovada" : "recusada"}.${note}`);
    })();
  };

  const approve = (c: IncomingCharge) => decideOptimistic(c, "approve");

  const confirmDeny = () => {
    if (!denyTarget || !denyReason.trim()) return;
    const target = denyTarget;
    const reason = denyReason.trim();
    setDenyTarget(null);
    decideOptimistic(target, "deny", reason);
  };

  const requestDeny = (c: IncomingCharge) => {
    setDenyReason("");
    setDenyTarget(c);
  };

  const openReclassify = (c: IncomingCharge) => {
    setReclassProposedCc("");
    setReclassTarget(c);
  };

  const confirmReclassify = async () => {
    if (!reclassTarget || busyIds.has(reclassTarget.id)) return;
    const target = reclassTarget;
    const proposed = reclassProposedCc ? Number(reclassProposedCc) : null;
    setReclassTarget(null);
    setBusyIds((prev) => new Set(prev).add(target.id));
    setCharges((prev) =>
      prev?.map((x) => (x.id === target.id ? { ...x, status: "reclassifying" as const } : x)) ?? prev,
    );
    const { error } = await supabaseBrowser(supabaseToken).rpc("request_charge_reclassification", {
      p_id: target.id,
      p_proposed_cc_id: proposed,
    });
    setBusyIds((prev) => {
      const n = new Set(prev);
      n.delete(target.id);
      return n;
    });
    if (error) {
      setCharges((prev) => prev?.map((x) => (x.id === target.id ? target : x)) ?? prev);
      flash("Não foi possível solicitar a reclassificação.");
      return;
    }
    flash(`${target.display_id} enviada para reclassificação.`);
    void load();
  };

  const allCcGrouped = useMemo(() => {
    const map = new Map<string, typeof allCostCenters>();
    for (const cc of allCostCenters) {
      const list = map.get(cc.department) ?? [];
      list.push(cc);
      map.set(cc.department, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [allCostCenters]);

  const toggleCc = (id: number) =>
    setSelectedCcs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (!canSlack) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabaseBrowser(supabaseToken)
        .from("head_slack_prefs")
        .select("notifications_enabled")
        .eq("head_email", email)
        .maybeSingle();
      if (!cancelled) {
        setSlackOn(!!(data as { notifications_enabled?: boolean } | null)?.notifications_enabled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canSlack, supabaseToken, email]);

  const toggleSlack = async () => {
    if (slackBusy || slackOn === null) return;
    const next = !slackOn;
    setSlackBusy(true);
    setSlackOn(next);
    const { error } = await supabaseBrowser(supabaseToken).rpc("set_slack_pref", { p_enabled: next });
    setSlackBusy(false);
    if (error) {
      setSlackOn(!next);
      flash("Não foi possível atualizar a preferência de Slack.");
    }
  };

  const loading = charges === null;

  return (
    <div>
      <div className="reveal reveal-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cobranças</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Aprove ou recuse as cobranças dos seus centros de custo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canDelegate && (
            <button
              onClick={() => setFeriasOpen(true)}
              title="Alocar um substituto para responder suas cobranças enquanto você estiver fora"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span aria-hidden>🏖️</span>
              Delegar aprovação (Ausência)
            </button>
          )}
          {canSlack && slackOn !== null && (
            <button
              onClick={() => void toggleSlack()}
              disabled={slackBusy}
              aria-pressed={slackOn}
              title="Receber no Slack uma notificação para cada nova cobrança dos seus centros de custo"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-60 ${
                slackOn
                  ? "border-[var(--approved)] bg-[var(--approved-soft)] text-[var(--approved)]"
                  : "border-[var(--line-strong)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
              }`}
            >
              <span aria-hidden>{slackOn ? "🔔" : "🔕"}</span>
              Slack {slackOn ? "ativo" : "desativado"}
            </button>
          )}
          {actionableCount > 0 && (
            <button
              onClick={() => queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              title="Ir para a tabela de cobranças"
              className="rounded-full bg-[var(--pending-soft)] px-4 py-1.5 v-tabular text-sm font-bold text-[var(--pending)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {actionableCount} a decidir ↓
            </button>
          )}
        </div>
      </div>

      {toast && (
        <p
          role="status"
          className="reveal mt-5 rounded-lg border border-[var(--approved)] bg-[var(--approved-soft)] px-4 py-2.5 text-sm text-[var(--approved)]"
        >
          {toast}
        </p>
      )}

      {/* ─── Budget overview (approved + pending charges vs budget, by due date) ─── */}
      {hasCenters && (
        <>
          <div className="reveal reveal-2 mt-7">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="charges-month" className="text-xs font-medium text-[var(--muted)]">
                Mês de referência
              </label>
              <select
                id="charges-month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-1.5 text-sm font-medium capitalize text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m}>{monthName(m)}</option>
                ))}
              </select>
              <CcMultiSelect
                centers={filterableCenters}
                selected={selectedCcs}
                onToggle={toggleCc}
                onClear={() => setSelectedCcs(new Set())}
              />
              {selectedMonth !== monthStart && (
                <button
                  onClick={() => setSelectedMonth(monthStart)}
                  className="text-xs font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Voltar ao mês atual
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Budget do mês" value={loading ? null : formatBRL(totals.budget)} />
              <Stat
                label="Comprometido"
                value={loading ? null : formatBRL(totals.committed)}
                tone="pending"
                sub={totals.pending > 0 ? `${formatBRL(totals.pending)} pendente` : undefined}
              />
              <Stat label="Disponível" value={loading ? null : formatBRL(totals.available)} tone="approved" />
            </div>
            {isMockOrEmpty && (
              <p className="mt-2 v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
                * sem orçamento cadastrado para estes centros de custo
              </p>
            )}
            {foreignThisMonth > 0 && (
              <p className="mt-1 v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
                {foreignThisMonth} cobrança(s) em outras moedas neste mês — não somadas ao budget (sem conversão)
              </p>
            )}
          </div>

          {relevantCenters.length > 0 && (
            <div className="reveal reveal-3 mt-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
                  Por centro de custo — {monthName(selectedMonth)} · clique para abrir
                </p>
                <div
                  role="group"
                  aria-label="Alternar entre pizza ou barras"
                  className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] p-0.5"
                >
                  {(["pizza", "barra"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      aria-pressed={viewMode === mode}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        viewMode === mode
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "text-[var(--muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {mode === "pizza" ? "Pizzas" : "Barras"}
                    </button>
                  ))}
                </div>
              </div>

              <HeadAggregateChart data={aggregateData} viewMode={viewMode} onOpenCenter={setDetailCc} />

              {viewMode === "pizza" && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {relevantCenters.map((cc) => {
                    const budget = budgetByCenter.get(cc.id) ?? 0;
                    const consumed = committedByCenter.get(cc.id) ?? 0;
                    return (
                      <button
                        key={cc.id}
                        onClick={() => setDetailCc(cc)}
                        className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-[var(--shadow)] transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        title="Abrir detalhes e decidir"
                      >
                        <BudgetDonut consumed={consumed} budget={budget} />
                        <div className="min-w-0 flex-1">
                          <p className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">{cc.code}</p>
                          <p className="mt-0.5 truncate text-sm font-semibold" title={cc.name}>{cc.name}</p>
                          <p className="mt-2 v-tabular text-xs text-[var(--muted)]">
                            <span className="text-[var(--ink)]">{formatBRL(consumed)}</span>
                            {budget > 0 && <> / {formatBRL(budget)}</>}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Charges table (single; per-column value filters + sort + global search) */}
      <div ref={queueRef} className="reveal reveal-4 mt-8 scroll-mt-4 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
              Cobranças
            </h2>
            <span className="hidden v-tabular text-[10px] text-[var(--faint)] sm:inline">
              ordene/filtre clicando nos cabeçalhos
            </span>
          </div>
          <div className="flex items-center gap-2">
            {anyTableFilter && (
              <button
                onClick={clearFilters}
                className="rounded text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Limpar filtros
              </button>
            )}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar fornecedor, NF, ID…"
              aria-label="Buscar nas cobranças"
              className="w-56 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1 text-[11px] text-[var(--ink)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {loading ? (
          <div role="status" aria-label="Carregando cobranças">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full" aria-label="Cobranças">
                <thead>
                  <tr className="border-b border-[var(--line)]">
                    <FilterHeader label="ID" field="id" active={sortField} dir={sortDir} setSort={setSort} width="80px" className="pl-5" />
                    <FilterHeader label="Data da solicitação" field="request" active={sortField} dir={sortDir} setSort={setSort} width="120px" />
                    <FilterHeader
                      label="Fornecedor" field="supplier" active={sortField} dir={sortDir} setSort={setSort}
                      options={filterOptions.supplier} excluded={excluded.supplier}
                      onToggle={(v) => toggleVal("supplier", v)} onSelectAll={() => selectAllVals("supplier")} onClearAll={() => clearVals("supplier", filterOptions.supplier)}
                    />
                    <FilterHeader
                      label="Centro de custo" field="cc" active={sortField} dir={sortDir} setSort={setSort}
                      options={filterOptions.cc} excluded={excluded.cc}
                      onToggle={(v) => toggleVal("cc", v)} onSelectAll={() => selectAllVals("cc")} onClearAll={() => clearVals("cc", filterOptions.cc)}
                    />
                    <FilterHeader
                      label="Aprovar até" field="due" active={sortField} dir={sortDir} setSort={setSort} align="right" width="110px"
                      options={filterOptions.venc} excluded={excluded.venc}
                      onToggle={(v) => toggleVal("venc", v)} onSelectAll={() => selectAllVals("venc")} onClearAll={() => clearVals("venc", filterOptions.venc)}
                    />
                    <FilterHeader
                      label="Data de pagamento" field="payment" active={sortField} dir={sortDir} setSort={setSort} align="right" width="120px"
                      options={filterOptions.payment} excluded={excluded.payment}
                      onToggle={(v) => toggleVal("payment", v)} onSelectAll={() => selectAllVals("payment")} onClearAll={() => clearVals("payment", filterOptions.payment)}
                    />
                    <FilterHeader label="Valor" field="amount" active={sortField} dir={sortDir} setSort={setSort} align="right" width="110px" />
                    <FilterHeader
                      label="Status" field="status" active={sortField} dir={sortDir} setSort={setSort} width="130px"
                      options={filterOptions.status} excluded={excluded.status}
                      onToggle={(v) => toggleVal("status", v)} onSelectAll={() => selectAllVals("status")} onClearAll={() => clearVals("status", filterOptions.status)}
                    />
                    <th scope="col" className="w-[230px] px-5 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-12 text-center text-sm text-[var(--faint)]">
                        Nenhuma cobrança {anyTableFilter ? "com os filtros atuais" : "por aqui"}.
                      </td>
                    </tr>
                  ) : (
                    pager.pageItems.map((c) => (
                    <tr key={c.id} className="border-b border-[var(--line)] last:border-b-0 align-top">
                      <td className="px-5 py-3.5 v-tabular text-xs font-semibold text-[var(--accent)]">{c.display_id}</td>
                      <td className="px-2 py-3.5 v-tabular text-[11px] text-[var(--muted)]">
                        {c.request_date ? brtDateTimeBR(c.request_date) : "—"}
                      </td>
                      <td className="px-2 py-3.5">
                        <div className="text-sm font-medium">
                          {c.supplier_name}
                          {c.sheet_name === "RH" && (
                            <span className="ml-2 rounded bg-[var(--rejected-soft)] px-1.5 py-0.5 v-tabular text-[9px] font-bold uppercase tracking-wider text-[var(--rejected)]">
                              RH · confidencial
                            </span>
                          )}
                        </div>
                        {c.nf_number && <div className="text-xs text-[var(--muted)]">NF {c.nf_number}</div>}
                        {c.description && (
                          <div className="max-w-[28ch] truncate text-xs text-[var(--muted)]" title={c.description}>{c.description}</div>
                        )}
                        <RateioLine observation={c.observation} />
                        <ChargeLinks charge={c} />
                      </td>
                      <td className="px-2 py-3.5">
                        <div className="text-xs font-medium">{c.cost_centers?.department ?? "—"}</div>
                        <div className="text-[11px] text-[var(--faint)]">
                          {c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : c.cost_center_id}
                        </div>
                        {c.pix_key && <div className="mt-0.5 text-[11px] text-[var(--muted)]">Pix: {c.pix_key}</div>}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-xs">
                        {(() => {
                          const s = displaySchedule(c);
                          if (!s.vencimento) return <span className="text-[var(--muted)]">—</span>;
                          return (
                            <>
                              {s.rolled && s.prevVenc && (
                                <div className="text-[var(--rejected)] line-through">{formatDateOnlyBR(s.prevVenc)}</div>
                              )}
                              <div className="text-[var(--ink)]" title="Último dia para aprovar e manter o pagamento na data prevista.">
                                {formatDateOnlyBR(s.vencimento)}
                              </div>
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-xs text-[var(--ink)]">
                        {(() => {
                          const s = displaySchedule(c);
                          if (!s.paymentDate) return <span className="text-[var(--muted)]">—</span>;
                          return (
                            <>
                              {s.rolled && s.prevPayment && (
                                <div className="text-[var(--rejected)] line-through">{formatDateOnlyBR(s.prevPayment)}</div>
                              )}
                              <div>{formatDateOnlyBR(s.paymentDate)}</div>
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-sm font-bold">{fmtMoney(Number(c.amount), c.currency)}</td>
                      <td className="px-2 py-3.5"><ChargeStatusBadge status={c.status} /></td>
                      <td className="px-5 py-3.5 text-right">
                        {c.status === "pending" ? (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              onClick={() => void approve(c)}
                              disabled={busyIds.has(c.id)}
                              className="rounded-lg bg-[var(--approved)] px-3 py-1.5 text-xs font-bold text-[var(--on-status)] transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              {busyIds.has(c.id) ? "…" : "Aprovar"}
                            </button>
                            <button
                              onClick={() => requestDeny(c)}
                              disabled={busyIds.has(c.id)}
                              className="rounded-lg border border-[var(--rejected)] px-3 py-1.5 text-xs font-bold text-[var(--rejected)] transition hover:bg-[var(--rejected-soft)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              Recusar
                            </button>
                            {!c.is_rateio && c.sheet_name !== "RH" && (
                              <button
                                onClick={() => openReclassify(c)}
                                disabled={busyIds.has(c.id)}
                                title="Solicitar mudança de centro de custo"
                                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--surface-2)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                              >
                                Reclassificar
                              </button>
                            )}
                          </div>
                        ) : c.status === "reclassifying" ? (
                          <span className="v-tabular text-[11px] text-[var(--muted)]">em reclassificação</span>
                        ) : (
                          <span className="v-tabular text-[11px] text-[var(--muted)]" title={c.decided_by_email ?? undefined}>
                            {c.decided_at ? brtDateTimeBR(c.decided_at) : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {rows.length > 0 && (
              <Pagination
                page={pager.page}
                pageCount={pager.pageCount}
                onPage={pager.setPage}
                total={pager.total}
                start={pager.start}
                end={pager.end}
              />
            )}
          </>
        )}
      </div>

      {feriasOpen && (
        <FeriasDialog supabaseToken={supabaseToken} email={email} onClose={() => setFeriasOpen(false)} />
      )}

      {detailCc && (
        <ChargeDetailModal
          center={detailCc}
          budget={budgetByCenter.get(detailCc.id) ?? 0}
          charges={charges ?? []}
          codeToId={codeToId}
          monthStart={selectedMonth}
          busyIds={busyIds}
          onApprove={approve}
          onDeny={requestDeny}
          onClose={() => setDetailCc(null)}
        />
      )}

      {denyTarget && (
        <ConfirmDialog
          title={`Recusar ${denyTarget.display_id}?`}
          message={`${denyTarget.supplier_name} — ${fmtMoney(Number(denyTarget.amount), denyTarget.currency)}. Informe o motivo da recusa.`}
          confirmLabel="Recusar cobrança"
          tone="danger"
          busy={busyIds.has(denyTarget.id)}
          onConfirm={() => void confirmDeny()}
          onCancel={() => setDenyTarget(null)}
        >
          <textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder="Motivo da recusa (obrigatório)…"
            maxLength={2000}
            autoFocus
            className="input min-h-[4rem] w-full resize-y text-sm"
          />
        </ConfirmDialog>
      )}

      {reclassTarget && (
        <ConfirmDialog
          title={`Reclassificar ${reclassTarget.display_id}?`}
          message="A cobrança sai da sua fila e vai para reclassificação — Bruna ou Maria atribuirão o novo centro de custo. Você pode sugerir um CC abaixo (opcional)."
          confirmLabel="Solicitar reclassificação"
          busy={busyIds.has(reclassTarget.id)}
          onConfirm={() => void confirmReclassify()}
          onCancel={() => setReclassTarget(null)}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Sugestão de novo CC (opcional)</span>
            <select
              value={reclassProposedCc}
              onChange={(e) => setReclassProposedCc(e.target.value)}
              className="input w-full text-sm"
            >
              <option value="">Sem sugestão</option>
              {allCcGrouped.map(([dept, ccs]) => (
                <optgroup key={dept} label={dept}>
                  {ccs.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

// Budget-graph CC scope. Uses a portal dropdown (fixed positioning) so the panel
// is never clipped by an ancestor and its list scrolls reliably.
function CcMultiSelect({
  centers,
  selected,
  onToggle,
  onClear,
}: {
  centers: CostCenter[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const W = 320;

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const left = Math.max(8, Math.min(b.left, window.innerWidth - W - 8));
    const spaceBelow = window.innerHeight - b.bottom - 16;
    setPos({ top: Math.round(b.bottom + 4), left: Math.round(left), maxH: Math.max(140, Math.min(340, spaceBelow - 72)) });
  };
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = (e?: Event) => {
      if (e && e.target instanceof Node && popRef.current?.contains(e.target)) return;
      place();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  if (centers.length === 0) return null;
  const label = selected.size === 0 ? "todos" : `${selected.size} de ${centers.length}`;
  const shown = centers.filter((cc) => `${cc.code} ${cc.name}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 rounded-lg border bg-[var(--bg)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          selected.size > 0 ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-strong)] text-[var(--ink)]"
        }`}
      >
        Centros: {label} <span className="text-[var(--faint)]">▾</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: W }}
            className="z-[70] rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[var(--shadow)]"
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">
                {centers.length} com cobranças
              </span>
              {selected.size > 0 && (
                <button onClick={onClear} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">
                  Limpar
                </button>
              )}
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar centro…"
              aria-label="Buscar centro de custo"
              className="mb-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--ink)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
            />
            <div className="overflow-y-auto" style={{ maxHeight: pos.maxH }}>
              {shown.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-[var(--faint)]">Nenhum centro.</p>
              ) : (
                shown.map((cc) => (
                  <label
                    key={cc.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-[var(--surface-2)]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(cc.id)}
                      onChange={() => onToggle(cc.id)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="v-tabular text-xs font-semibold">{cc.code}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]" title={cc.name}>{cc.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function ChargeLinks({ charge }: { charge: IncomingCharge }) {
  if (!charge.attachment_url && !charge.boleto_url) return null;
  return (
    <div className="mt-1 flex gap-3">
      {charge.attachment_url && (
        <a href={charge.attachment_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          NF / recibo ↗
        </a>
      )}
      {charge.boleto_url && (
        <a href={charge.boleto_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          Boleto ↗
        </a>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="border-b border-[var(--line)] px-5 py-3.5 last:border-b-0">
      <div className="flex items-center gap-4">
        <div className="h-3.5 w-14 shrink-0 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="h-3.5 flex-1 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="h-8 w-40 shrink-0 animate-pulse rounded-lg bg-[var(--surface-2)]" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string | null;
  tone?: "pending" | "approved";
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
      <p className="v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">{label}</p>
      {value === null ? (
        <div className="mt-2 h-6 w-24 animate-pulse rounded-md bg-[var(--surface-2)]" />
      ) : (
        <p
          className="mt-1.5 truncate v-tabular text-lg font-bold"
          style={tone ? { color: `var(--${tone})` } : undefined}
          title={value}
        >
          {value}
        </p>
      )}
      {sub && value !== null && <p className="mt-0.5 v-tabular text-[11px] text-[var(--faint)]">{sub}</p>}
    </div>
  );
}
