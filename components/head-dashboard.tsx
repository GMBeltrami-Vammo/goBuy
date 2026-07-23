"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { Pagination, usePagination } from "@/components/pagination";
import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { FilterHeader, type FilterOption } from "@/components/table-filter";
import { useSort } from "@/components/table-sort";
import { brtYmd, formatBRL, formatDate, STATUS_LABEL, TYPE_LABEL } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, CostCenterBudget, PurchaseRequest, RequestStatus, RequestType } from "@/lib/types";

// recharts is heavy — load it only when this dashboard renders.
const BudgetDonut = dynamic(
  () => import("@/components/budget-donut").then((m) => m.BudgetDonut),
  { ssr: false, loading: () => <div className="h-36 w-36 animate-pulse rounded-full bg-[var(--surface-2)]" /> },
);
const BudgetDetailModal = dynamic(
  () => import("@/components/budget-detail-modal").then((m) => m.BudgetDetailModal),
  { ssr: false },
);
const HeadAggregateChart = dynamic(
  () => import("@/components/head-aggregate-chart").then((m) => m.HeadAggregateChart),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-xl bg-[var(--surface-2)]" /> },
);

/** Statuses that consume budget: aprovada em diante (exceto recusada/cancelada). */
const COMMITTED_STATUSES = new Set(["approved", "awaiting_finance", "awaiting_payment", "paid"]);

// ─── Sorting ──────────────────────────────────────────────────────────────────
// Shared by both tables (pending queue + recent history), over PurchaseRequest.
type SortField = "id" | "supplier" | "dept" | "type" | "amount" | "created" | "decided" | "status";

// Status display + sort order (request lifecycle: actionable → settled).
const STATUS_ORDER: RequestStatus[] = [
  "pending",
  "approved",
  "awaiting_finance",
  "awaiting_payment",
  "paid",
  "rejected",
  "cancelled",
];
const STATUS_RANK = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i])) as Record<RequestStatus, number>;

function requestSortKey(r: PurchaseRequest, field: SortField): string | number {
  switch (field) {
    case "id":
      return r.display_id ?? "";
    case "supplier":
      return (r.supplier_name ?? "").toLowerCase();
    case "dept":
      return (r.cost_centers?.department ?? "").toLowerCase();
    case "type":
      return TYPE_LABEL[r.request_type] ?? r.request_type;
    case "amount":
      return Number(r.total_amount) || 0;
    case "created":
      return r.created_at ?? "";
    case "decided":
      return r.decided_at ?? r.cancelled_at ?? "";
    case "status":
      return STATUS_RANK[r.status];
  }
}

function compareRequests(
  a: PurchaseRequest,
  b: PurchaseRequest,
  field: SortField,
  dir: "asc" | "desc",
): number {
  const ka = requestSortKey(a, field);
  const kb = requestSortKey(b, field);
  const aEmpty = ka === "";
  const bEmpty = kb === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp =
    typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
  return dir === "asc" ? cmp : -cmp;
}

// ─── Per-column value filters ──────────────────────────────────────────────────
// `excluded` holds the UNCHECKED values per column (a row passes when its value is
// not there). Built so the two tables can each own an independent filter state.
const optionsByLabel = (m: Map<string, string>): FilterOption[] =>
  [...m.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => (a.value === "" ? 1 : b.value === "" ? -1 : a.label.localeCompare(b.label)));

const supplierOptions = (rows: PurchaseRequest[]): FilterOption[] => {
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.supplier_name ?? "", r.supplier_name ?? "");
  return optionsByLabel(m);
};
const deptOptions = (rows: PurchaseRequest[]): FilterOption[] => {
  const m = new Map<string, string>();
  for (const r of rows) {
    const d = r.cost_centers?.department ?? "";
    m.set(d, d);
  }
  return optionsByLabel(m);
};
const typeOptions = (rows: PurchaseRequest[]): FilterOption[] =>
  (Object.keys(TYPE_LABEL) as RequestType[])
    .filter((t) => rows.some((r) => r.request_type === t))
    .map((t) => ({ value: t, label: TYPE_LABEL[t] }));
const statusOptions = (rows: PurchaseRequest[]): FilterOption[] =>
  STATUS_ORDER.filter((s) => rows.some((r) => r.status === s)).map((s) => ({ value: s, label: STATUS_LABEL[s] }));

// Stable pagination reset-key signature for a table's active value filters.
const excludedSignature = (excluded: Record<string, Set<string>>) =>
  Object.entries(excluded)
    .map(([k, s]) => `${k}:${[...s].sort().join("|")}`)
    .sort()
    .join(";");

// The three value-filter handlers, bound to a given table's excluded-state setter.
function makeExcludedHandlers(setExcluded: Dispatch<SetStateAction<Record<string, Set<string>>>>) {
  return {
    toggleVal: (key: string, v: string) =>
      setExcluded((prev) => {
        const s = new Set(prev[key] ?? []);
        if (s.has(v)) s.delete(v);
        else s.add(v);
        return { ...prev, [key]: s };
      }),
    selectAllVals: (key: string) => setExcluded((prev) => ({ ...prev, [key]: new Set<string>() })),
    clearVals: (key: string, opts: FilterOption[]) =>
      setExcluded((prev) => ({ ...prev, [key]: new Set(opts.map((o) => o.value)) })),
  };
}

export function HeadDashboard({
  email,
  centerIds,
  supabaseToken,
  autoOpenDisplayId,
}: {
  email: string;
  centerIds: number[];
  supabaseToken: string;
  autoOpenDisplayId?: string;
}) {
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [budgets, setBudgets] = useState<CostCenterBudget[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [openRequest, setOpenRequest] = useState<PurchaseRequest | null>(null);
  const [detailCenter, setDetailCenter] = useState<CostCenter | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"pizza" | "barra">("pizza");
  const autoOpened = useRef(false);

  // Each table owns its own sort + per-column value filters.
  const {
    field: pendingSortField,
    dir: pendingSortDir,
    setSort: setPendingSort,
  } = useSort<SortField>("created", "asc");
  const [pendingExcluded, setPendingExcluded] = useState<Record<string, Set<string>>>({});
  const {
    field: recentSortField,
    dir: recentSortDir,
    setSort: setRecentSort,
  } = useSort<SortField>("decided", "desc");
  const [recentExcluded, setRecentExcluded] = useState<Record<string, Set<string>>>({});
  const pendFilter = makeExcludedHandlers(setPendingExcluded);
  const recFilter = makeExcludedHandlers(setRecentExcluded);

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  }, []);
  // Heads may review/plan other months (e.g. next month's requests), so the
  // dashboard is scoped to a selectable reference month.
  const [selectedMonth, setSelectedMonth] = useState(monthStart);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser(supabaseToken);
    const [ccRes, budgetRes, reqRes] = await Promise.all([
      supabase.from("cost_centers").select("id, code, name, department, active").in("id", centerIds),
      supabase
        .from("cost_center_budgets")
        .select("id, cost_center_id, period_month, amount, source")
        .in("cost_center_id", centerIds),
      supabase
        .from("purchase_requests")
        .select("*, cost_centers(code, name, department), request_allocations(cost_center_id, percentage, approved_at, approved_by_email)")
        .in("cost_center_id", centerIds)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    setCenters((ccRes.data as unknown as CostCenter[]) ?? []);
    setBudgets((budgetRes.data as unknown as CostCenterBudget[]) ?? []);
    setRequests((reqRes.data as unknown as PurchaseRequest[]) ?? []);
  }, [centerIds, supabaseToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-open a specific request when linked from Slack.
  useEffect(() => {
    if (!autoOpenDisplayId || autoOpened.current || !requests) return;
    const match = requests.find((r) => r.display_id === autoOpenDisplayId);
    if (match) {
      autoOpened.current = true;
      setOpenRequest(match);
    }
  }, [autoOpenDisplayId, requests]);

  // Months that have a budget for these centers, plus the current month, sorted
  // descending so the latest is first in the picker.
  const availableMonths = useMemo(() => {
    const set = new Set<string>(budgets.map((b) => b.period_month.slice(0, 10)));
    set.add(monthStart);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [budgets, monthStart]);

  // Committed in the selected month = anything approved onwards (incl. awaiting
  // finance / payment) created in that month.
  const committedByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of requests ?? []) {
      if (!COMMITTED_STATUSES.has(r.status)) continue;
      if (brtYmd(r.created_at).slice(0, 7) !== selectedMonth.slice(0, 7)) continue;
      map.set(r.cost_center_id, (map.get(r.cost_center_id) ?? 0) + Number(r.total_amount));
    }
    return map;
  }, [requests, selectedMonth]);

  const budgetByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of budgets) {
      if (b.period_month.slice(0, 10) === selectedMonth) map.set(b.cost_center_id, Number(b.amount));
    }
    return map;
  }, [budgets, selectedMonth]);

  const totals = useMemo(() => {
    const budget = centers.reduce((a, c) => a + (budgetByCenter.get(c.id) ?? 0), 0);
    const committed = centers.reduce((a, c) => a + (committedByCenter.get(c.id) ?? 0), 0);
    return { budget, committed, available: Math.max(0, budget - committed) };
  }, [centers, budgetByCenter, committedByCenter]);

  const pendingByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of requests ?? []) {
      if (r.status !== "pending") continue;
      for (const a of r.request_allocations ?? []) {
        if (centerIds.includes(a.cost_center_id) && !a.approved_at) {
          map.set(a.cost_center_id, (map.get(a.cost_center_id) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [requests, centerIds]);

  // ─── Pending queue: base backlog (for count) → value filters → sort ───────────
  const pendingBase = useMemo(
    () =>
      (requests ?? []).filter((r) => {
        if (r.status !== "pending") return false;
        const allocs = r.request_allocations ?? [];
        if (allocs.length === 0) return true;
        return allocs.some((a) => centerIds.includes(a.cost_center_id) && !a.approved_at);
      }),
    [requests, centerIds],
  );

  const pendingOptions = useMemo(
    () => ({
      supplier: supplierOptions(pendingBase),
      dept: deptOptions(pendingBase),
      type: typeOptions(pendingBase),
    }),
    [pendingBase],
  );

  const pendingRows = useMemo(() => {
    const list = pendingBase.filter((r) => {
      if (pendingExcluded.supplier?.has(r.supplier_name ?? "")) return false;
      if (pendingExcluded.dept?.has(r.cost_centers?.department ?? "")) return false;
      if (pendingExcluded.type?.has(r.request_type)) return false;
      return true;
    });
    return [...list].sort((a, b) => compareRequests(a, b, pendingSortField, pendingSortDir));
  }, [pendingBase, pendingExcluded, pendingSortField, pendingSortDir]);

  // ─── Recent decisions: everything not pending → value filters → sort ──────────
  const recentBase = useMemo(() => (requests ?? []).filter((r) => r.status !== "pending"), [requests]);

  const recentOptions = useMemo(
    () => ({
      supplier: supplierOptions(recentBase),
      dept: deptOptions(recentBase),
      type: typeOptions(recentBase),
      status: statusOptions(recentBase),
    }),
    [recentBase],
  );

  const recentRows = useMemo(() => {
    const list = recentBase.filter((r) => {
      if (recentExcluded.supplier?.has(r.supplier_name ?? "")) return false;
      if (recentExcluded.dept?.has(r.cost_centers?.department ?? "")) return false;
      if (recentExcluded.type?.has(r.request_type)) return false;
      if (recentExcluded.status?.has(r.status)) return false;
      return true;
    });
    return [...list].sort((a, b) => compareRequests(a, b, recentSortField, recentSortDir));
  }, [recentBase, recentExcluded, recentSortField, recentSortDir]);

  const pendingPager = usePagination(
    pendingRows,
    `pending|${excludedSignature(pendingExcluded)}|${pendingSortField}|${pendingSortDir}`,
  );
  const recentPager = usePagination(
    recentRows,
    `recent|${excludedSignature(recentExcluded)}|${recentSortField}|${recentSortDir}`,
  );

  const anyPendingFilter = ["supplier", "dept", "type"].some((k) => (pendingExcluded[k]?.size ?? 0) > 0);
  const anyRecentFilter = ["supplier", "dept", "type", "status"].some(
    (k) => (recentExcluded[k]?.size ?? 0) > 0,
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  const monthName = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthLabel = monthName(selectedMonth);
  const isMock = budgets.some((b) => b.period_month.slice(0, 10) === selectedMonth && b.source === "mock");

  const aggregateData = useMemo(
    () =>
      centers.map((cc) => ({
        cc,
        committed: committedByCenter.get(cc.id) ?? 0,
        budget: budgetByCenter.get(cc.id) ?? 0,
      })),
    [centers, committedByCenter, budgetByCenter],
  );

  const loading = requests === null;

  return (
    <div>
      <div className="reveal reveal-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Aprovações</h1>
          {loading ? (
            <div className="mt-2 h-4 w-64 animate-pulse rounded bg-[var(--surface-2)]" />
          ) : (
            <p className="mt-1 text-sm text-[var(--muted)]">
              {centers.length} centro{centers.length === 1 ? "" : "s"} de custo sob sua
              responsabilidade · {monthLabel}
            </p>
          )}
        </div>
        {pendingBase.length > 0 && (
          <span className="rounded-full bg-[var(--pending-soft)] px-4 py-1.5 v-tabular text-sm font-bold text-[var(--pending)]">
            {pendingBase.length} pendente{pendingBase.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {toast && (
        <p
          role="status"
          className="reveal mt-5 rounded-lg border border-[var(--approved)] bg-[var(--approved-soft)] px-4 py-2.5 text-sm text-[var(--approved)]"
        >
          {toast}
        </p>
      )}

      {/* Aggregate budget */}
      <div className="reveal reveal-2 mt-7">
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="head-month" className="text-xs font-medium text-[var(--muted)]">
            Mês de referência
          </label>
          <select
            id="head-month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-1.5 text-sm font-medium capitalize text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
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
          <Stat label="Comprometido" value={loading ? null : formatBRL(totals.committed)} tone="pending" />
          <Stat label="Disponível" value={loading ? null : formatBRL(totals.available)} tone="approved" />
        </div>
      </div>
      {isMock && (
        <p className="mt-2 v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
          * orçamento simulado (source: mock) — substituível via finance.cost_center_budgets
        </p>
      )}

      {/* Aggregate chart + per-CC drill-down */}
      <div className="reveal reveal-3 mt-6 space-y-4">
        {/* Toggle */}
        <div className="flex items-center justify-between gap-3">
          <p className="v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
            Por centro de custo — {monthLabel}
          </p>
          <div
            role="group"
            aria-label="Alternar entre visualização em pizza ou barras"
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

        {/* Consolidated chart — always shown, pizza or bar */}
        <HeadAggregateChart
          data={aggregateData}
          viewMode={viewMode}
          onOpenCenter={setDetailCenter}
        />

        {/* Per-CC donut cards — drill-down, only in pizza mode */}
        {viewMode === "pizza" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {centers.map((cc) => {
              const budget = budgetByCenter.get(cc.id) ?? 0;
              const consumed = committedByCenter.get(cc.id) ?? 0;
              const pendingCount = pendingByCenter.get(cc.id) ?? 0;
              return (
                <button
                  key={cc.id}
                  onClick={() => setDetailCenter(cc)}
                  className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-[var(--shadow)] transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  title="Ver detalhes do budget"
                >
                  <BudgetDonut consumed={consumed} budget={budget} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <p className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">
                        {cc.code}
                      </p>
                      {pendingCount > 0 && (
                        <span className="shrink-0 rounded-full bg-[var(--pending-soft)] px-2 py-0.5 v-tabular text-[10px] font-bold text-[var(--pending)]">
                          {pendingCount} pend.
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm font-semibold" title={cc.name}>
                      {cc.name}
                    </p>
                    <p className="mt-2 v-tabular text-xs text-[var(--muted)]">
                      <span className="text-[var(--ink)]">{formatBRL(consumed)}</span>
                      {budget > 0 && <> / {formatBRL(budget)}</>}
                    </p>
                    <p className="mt-1 text-[10px] font-semibold text-[var(--accent)]">
                      Detalhes →
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending queue — per-column value filters + sort */}
      <div className="reveal reveal-4 mt-8 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
              Aguardando sua aprovação
            </h2>
            <span className="hidden v-tabular text-[10px] text-[var(--faint)] sm:inline">
              ordene/filtre clicando nos cabeçalhos
            </span>
          </div>
          {anyPendingFilter && (
            <button
              onClick={() => setPendingExcluded({})}
              className="rounded text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {loading ? (
          <div role="status" aria-label="Carregando solicitações pendentes">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Solicitações aguardando aprovação">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-[var(--line)]">
                  <FilterHeader label="ID" field="id" active={pendingSortField} dir={pendingSortDir} setSort={setPendingSort} width="90px" className="pl-5" />
                  <FilterHeader
                    label="Fornecedor" field="supplier" active={pendingSortField} dir={pendingSortDir} setSort={setPendingSort}
                    options={pendingOptions.supplier} excluded={pendingExcluded.supplier}
                    onToggle={(v) => pendFilter.toggleVal("supplier", v)} onSelectAll={() => pendFilter.selectAllVals("supplier")} onClearAll={() => pendFilter.clearVals("supplier", pendingOptions.supplier)}
                  />
                  <FilterHeader
                    label="Departamento" field="dept" active={pendingSortField} dir={pendingSortDir} setSort={setPendingSort} width="180px"
                    options={pendingOptions.dept} excluded={pendingExcluded.dept}
                    onToggle={(v) => pendFilter.toggleVal("dept", v)} onSelectAll={() => pendFilter.selectAllVals("dept")} onClearAll={() => pendFilter.clearVals("dept", pendingOptions.dept)}
                  />
                  <FilterHeader
                    label="Tipo" field="type" active={pendingSortField} dir={pendingSortDir} setSort={setPendingSort} width="120px"
                    options={pendingOptions.type} excluded={pendingExcluded.type}
                    onToggle={(v) => pendFilter.toggleVal("type", v)} onSelectAll={() => pendFilter.selectAllVals("type")} onClearAll={() => pendFilter.clearVals("type", pendingOptions.type)}
                  />
                  <FilterHeader label="Valor" field="amount" active={pendingSortField} dir={pendingSortDir} setSort={setPendingSort} align="right" width="110px" />
                  <FilterHeader label="Data" field="created" active={pendingSortField} dir={pendingSortDir} setSort={setPendingSort} align="right" width="120px" />
                  <th scope="col" className="w-[90px] px-5 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Ação</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-[var(--faint)]">
                      Nenhuma solicitação {anyPendingFilter ? "com os filtros atuais" : "pendente por aqui"}.
                    </td>
                  </tr>
                ) : (
                  pendingPager.pageItems.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setOpenRequest(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenRequest(r);
                      }
                    }}
                    tabIndex={0}
                    className="table-row-hover cursor-pointer border-b border-[var(--line)] last:border-b-0 focus-visible:outline-none focus-visible:bg-[var(--surface-2)]"
                    aria-label={`Revisar solicitação ${r.display_id} — ${r.supplier_name}`}
                  >
                    <td className="px-5 py-3.5 v-tabular text-xs font-semibold text-[var(--accent)]">
                      {r.display_id}
                    </td>
                    <td className="px-2 py-3.5">
                      <div className="text-sm font-medium">{r.supplier_name}</div>
                      <div className="truncate text-xs text-[var(--muted)]">{r.requester_email}</div>
                    </td>
                    <td className="hidden px-2 py-3.5 sm:table-cell">
                      <div className="truncate text-xs font-medium">{r.cost_centers?.department ?? "—"}</div>
                      <div className="truncate text-[11px] text-[var(--faint)]">
                        {r.cost_centers ? `${r.cost_centers.code} — ${r.cost_centers.name}` : r.cost_center_id}
                      </div>
                    </td>
                    <td className="hidden px-2 py-3.5 sm:table-cell">
                      <TypeBadge type={r.request_type} />
                    </td>
                    <td className="px-2 py-3.5 text-right v-tabular text-sm font-bold">
                      {formatBRL(Number(r.total_amount))}
                    </td>
                    <td className="hidden px-2 py-3.5 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="hidden px-5 py-3.5 text-right v-tabular text-xs font-semibold text-[var(--accent)] sm:table-cell">
                      Revisar →
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {pendingRows.length > 0 && (
          <Pagination
            page={pendingPager.page}
            pageCount={pendingPager.pageCount}
            onPage={pendingPager.setPage}
            total={pendingPager.total}
            start={pendingPager.start}
            end={pendingPager.end}
          />
        )}
      </div>

      {/* Recent decisions — per-column value filters + sort */}
      {recentBase.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
            <div className="flex items-center gap-3">
              <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
                Recentes
              </h2>
              <span className="hidden v-tabular text-[10px] text-[var(--faint)] sm:inline">
                ordene/filtre clicando nos cabeçalhos
              </span>
            </div>
            {anyRecentFilter && (
              <button
                onClick={() => setRecentExcluded({})}
                className="rounded text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Limpar filtros
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Decisões recentes">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-[var(--line)]">
                  <FilterHeader label="ID" field="id" active={recentSortField} dir={recentSortDir} setSort={setRecentSort} width="90px" className="pl-5" />
                  <FilterHeader
                    label="Fornecedor" field="supplier" active={recentSortField} dir={recentSortDir} setSort={setRecentSort}
                    options={recentOptions.supplier} excluded={recentExcluded.supplier}
                    onToggle={(v) => recFilter.toggleVal("supplier", v)} onSelectAll={() => recFilter.selectAllVals("supplier")} onClearAll={() => recFilter.clearVals("supplier", recentOptions.supplier)}
                  />
                  <FilterHeader
                    label="Departamento" field="dept" active={recentSortField} dir={recentSortDir} setSort={setRecentSort} width="180px"
                    options={recentOptions.dept} excluded={recentExcluded.dept}
                    onToggle={(v) => recFilter.toggleVal("dept", v)} onSelectAll={() => recFilter.selectAllVals("dept")} onClearAll={() => recFilter.clearVals("dept", recentOptions.dept)}
                  />
                  <FilterHeader
                    label="Tipo" field="type" active={recentSortField} dir={recentSortDir} setSort={setRecentSort} width="120px"
                    options={recentOptions.type} excluded={recentExcluded.type}
                    onToggle={(v) => recFilter.toggleVal("type", v)} onSelectAll={() => recFilter.selectAllVals("type")} onClearAll={() => recFilter.clearVals("type", recentOptions.type)}
                  />
                  <FilterHeader label="Valor" field="amount" active={recentSortField} dir={recentSortDir} setSort={setRecentSort} align="right" width="110px" />
                  <FilterHeader label="Decidida em" field="decided" active={recentSortField} dir={recentSortDir} setSort={setRecentSort} align="right" width="120px" />
                  <FilterHeader
                    label="Status" field="status" active={recentSortField} dir={recentSortDir} setSort={setRecentSort} align="right" width="130px" className="pr-5"
                    options={recentOptions.status} excluded={recentExcluded.status}
                    onToggle={(v) => recFilter.toggleVal("status", v)} onSelectAll={() => recFilter.selectAllVals("status")} onClearAll={() => recFilter.clearVals("status", recentOptions.status)}
                  />
                </tr>
              </thead>
              <tbody>
                {recentRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-[var(--faint)]">
                      Nenhuma decisão com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  recentPager.pageItems.map((r) => {
                    const decidedOn = r.decided_at ?? r.cancelled_at;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setOpenRequest(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenRequest(r);
                          }
                        }}
                        tabIndex={0}
                        className="table-row-hover cursor-pointer border-b border-[var(--line)] last:border-b-0 focus-visible:outline-none focus-visible:bg-[var(--surface-2)]"
                        aria-label={`Abrir solicitação ${r.display_id} — ${r.supplier_name}`}
                      >
                        <td className="px-5 py-3 v-tabular text-xs font-semibold text-[var(--accent)]">
                          {r.display_id}
                        </td>
                        <td className="px-2 py-3">
                          <div className="text-sm font-medium">{r.supplier_name}</div>
                          <div className="truncate text-xs text-[var(--muted)]">{r.requester_email}</div>
                        </td>
                        <td className="hidden px-2 py-3 sm:table-cell">
                          <div className="truncate text-xs font-medium">{r.cost_centers?.department ?? "—"}</div>
                          <div className="truncate text-[11px] text-[var(--faint)]">
                            {r.cost_centers ? `${r.cost_centers.code} — ${r.cost_centers.name}` : r.cost_center_id}
                          </div>
                        </td>
                        <td className="hidden px-2 py-3 sm:table-cell">
                          <TypeBadge type={r.request_type} />
                        </td>
                        <td className="hidden px-2 py-3 text-right v-tabular text-sm font-semibold sm:table-cell">
                          {formatBRL(Number(r.total_amount))}
                        </td>
                        <td className="hidden px-2 py-3 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                          {decidedOn ? formatDate(decidedOn) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {recentRows.length > 0 && (
            <Pagination
              page={recentPager.page}
              pageCount={recentPager.pageCount}
              onPage={recentPager.setPage}
              total={recentPager.total}
              start={recentPager.start}
              end={recentPager.end}
            />
          )}
        </div>
      )}

      {detailCenter && (
        <BudgetDetailModal
          center={detailCenter}
          budget={budgetByCenter.get(detailCenter.id) ?? 0}
          requests={requests ?? []}
          monthStart={selectedMonth}
          onClose={() => setDetailCenter(null)}
          onOpenRequest={(r) => {
            setDetailCenter(null);
            setOpenRequest(r);
          }}
        />
      )}

      {openRequest && (
        <RequestDrawer
          key={openRequest.id}
          request={openRequest}
          viewerEmail={email}
          supabaseToken={supabaseToken}
          canDecide={
            openRequest.status === "pending" &&
            (openRequest.request_allocations ?? []).some(
              (a) => centerIds.includes(a.cost_center_id) && !a.approved_at,
            )
          }
          onClose={() => setOpenRequest(null)}
          onChanged={(msg) => {
            setOpenRequest(null);
            if (msg) flash(msg);
            void load();
          }}
        />
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
        <div className="h-5 w-24 shrink-0 animate-pulse rounded-full bg-[var(--surface-2)]" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: "pending" | "approved";
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
    </div>
  );
}
