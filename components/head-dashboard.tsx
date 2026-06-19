"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { brtYmd, formatBRL, formatDate } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, CostCenterBudget, PurchaseRequest } from "@/lib/types";

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

type SortKey = "value" | "date" | "department";

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
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [toast, setToast] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"pizza" | "barra">("pizza");
  const autoOpened = useRef(false);

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

  const pending = useMemo(() => {
    const list = (requests ?? []).filter((r) => {
      if (r.status !== "pending") return false;
      const allocs = r.request_allocations ?? [];
      if (allocs.length === 0) return true;
      return allocs.some((a) => centerIds.includes(a.cost_center_id) && !a.approved_at);
    });
    const sorted = [...list];
    if (sortKey === "value") sorted.sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
    if (sortKey === "date") sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortKey === "department")
      sorted.sort((a, b) =>
        (a.cost_centers?.department ?? "").localeCompare(b.cost_centers?.department ?? ""),
      );
    return sorted;
  }, [requests, sortKey, centerIds]);

  const recent = useMemo(
    () => (requests ?? []).filter((r) => r.status !== "pending").slice(0, 12),
    [requests],
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
          <p className="mt-1 text-sm text-[var(--muted)]">
            {centers.length} centro{centers.length === 1 ? "" : "s"} de custo sob sua
            responsabilidade · {monthLabel}
          </p>
        </div>
        {pending.length > 0 && (
          <span className="rounded-full bg-[var(--pending-soft)] px-4 py-1.5 v-tabular text-sm font-bold text-[var(--pending)]">
            {pending.length} pendente{pending.length === 1 ? "" : "s"}
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
          <div className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] p-0.5">
            {(["pizza", "barra"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
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

      {/* Pending queue */}
      <div className="reveal reveal-4 mt-8 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
            Aguardando sua aprovação
          </h2>
          <div className="flex items-center gap-1 text-xs">
            <span className="mr-1 text-[var(--faint)]">Ordenar:</span>
            {(
              [
                ["date", "Data"],
                ["value", "Valor"],
                ["department", "Departamento"],
              ] as [SortKey, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`rounded-full px-3 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  sortKey === k
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div role="status" aria-label="Carregando solicitações pendentes">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : pending.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma solicitação pendente por aqui.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Solicitações aguardando aprovação">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-[var(--line)]">
                  <th scope="col" className="w-[90px] px-5 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">ID</th>
                  <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Solicitação</th>
                  <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Tipo</th>
                  <th scope="col" className="w-[110px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Valor</th>
                  <th scope="col" className="w-[120px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Data</th>
                  <th scope="col" className="w-[90px] px-5 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Ação</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
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
                      <div className="truncate text-xs text-[var(--muted)]">
                        {r.requester_email} · {r.cost_centers?.department}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent decisions */}
      {recent.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
              Recentes
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Decisões recentes">
              <tbody>
                {recent.map((r) => (
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
                  >
                    <td className="w-[90px] px-5 py-3 v-tabular text-xs font-semibold text-[var(--accent)]">
                      {r.display_id}
                    </td>
                    <td className="px-2 py-3 text-sm">{r.supplier_name}</td>
                    <td className="hidden px-2 py-3 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                      {formatBRL(Number(r.total_amount))}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
