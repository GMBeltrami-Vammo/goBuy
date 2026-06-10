"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { formatBRL, formatDate } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, CostCenterBudget, PurchaseRequest } from "@/lib/types";

// recharts is heavy — load it only when this dashboard renders.
const BudgetDonut = dynamic(
  () => import("@/components/budget-donut").then((m) => m.BudgetDonut),
  { ssr: false, loading: () => <div className="h-36 w-36 animate-pulse rounded-full bg-[var(--surface-2)]" /> },
);

type SortKey = "value" | "date" | "department";

export function HeadDashboard({
  email,
  centerIds,
}: {
  email: string;
  centerIds: number[];
}) {
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [budgets, setBudgets] = useState<CostCenterBudget[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [openRequest, setOpenRequest] = useState<PurchaseRequest | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [toast, setToast] = useState<string | null>(null);

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  }, []);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [ccRes, budgetRes, reqRes] = await Promise.all([
      supabase.from("cost_centers").select("id, code, name, department, active").in("id", centerIds),
      supabase
        .from("cost_center_budgets")
        .select("id, cost_center_id, period_month, amount, source")
        .in("cost_center_id", centerIds)
        .eq("period_month", monthStart),
      supabase
        .from("purchase_requests")
        .select("*, cost_centers(code, name, department)")
        .in("cost_center_id", centerIds)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    setCenters((ccRes.data as unknown as CostCenter[]) ?? []);
    setBudgets((budgetRes.data as unknown as CostCenterBudget[]) ?? []);
    setRequests((reqRes.data as unknown as PurchaseRequest[]) ?? []);
  }, [centerIds, monthStart]);

  useEffect(() => {
    void load();
  }, [load]);

  // Committed this month = approved + paid requests created in the month.
  const committedByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of requests ?? []) {
      if (r.status !== "approved" && r.status !== "paid") continue;
      if (r.created_at.slice(0, 7) !== monthStart.slice(0, 7)) continue;
      map.set(r.cost_center_id, (map.get(r.cost_center_id) ?? 0) + Number(r.total_amount));
    }
    return map;
  }, [requests, monthStart]);

  const budgetByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of budgets) map.set(b.cost_center_id, Number(b.amount));
    return map;
  }, [budgets]);

  const totals = useMemo(() => {
    const budget = centers.reduce((a, c) => a + (budgetByCenter.get(c.id) ?? 0), 0);
    const committed = centers.reduce((a, c) => a + (committedByCenter.get(c.id) ?? 0), 0);
    return { budget, committed, available: Math.max(0, budget - committed) };
  }, [centers, budgetByCenter, committedByCenter]);

  const pending = useMemo(() => {
    const list = (requests ?? []).filter((r) => r.status === "pending");
    const sorted = [...list];
    if (sortKey === "value") sorted.sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
    if (sortKey === "date") sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortKey === "department")
      sorted.sort((a, b) =>
        (a.cost_centers?.department ?? "").localeCompare(b.cost_centers?.department ?? ""),
      );
    return sorted;
  }, [requests, sortKey]);

  const recent = useMemo(
    () => (requests ?? []).filter((r) => r.status !== "pending").slice(0, 12),
    [requests],
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  const monthLabel = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const isMock = budgets.some((b) => b.source === "mock");

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
        <p className="reveal mt-5 rounded-lg border border-[var(--approved)] bg-[var(--approved-soft)] px-4 py-2.5 text-sm text-[var(--approved)]">
          {toast}
        </p>
      )}

      {/* Aggregate budget */}
      <div className="reveal reveal-2 mt-7 grid grid-cols-3 gap-3">
        <Stat label="Budget do mês" value={formatBRL(totals.budget)} />
        <Stat label="Comprometido" value={formatBRL(totals.committed)} tone="pending" />
        <Stat label="Disponível" value={formatBRL(totals.available)} tone="approved" />
      </div>
      {isMock && (
        <p className="mt-2 v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
          * orçamento simulado (source: mock) — substituível via finance.cost_center_budgets
        </p>
      )}

      {/* Per-center donuts */}
      <div className="reveal reveal-3 mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {centers.map((cc) => {
          const budget = budgetByCenter.get(cc.id) ?? 0;
          const consumed = committedByCenter.get(cc.id) ?? 0;
          return (
            <div
              key={cc.id}
              className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]"
            >
              <BudgetDonut consumed={consumed} budget={budget} />
              <div className="min-w-0">
                <p className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">
                  {cc.code}
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold" title={cc.name}>
                  {cc.name}
                </p>
                <p className="mt-2 v-tabular text-xs text-[var(--muted)]">
                  <span className="text-[var(--ink)]">{formatBRL(consumed)}</span>
                  {budget > 0 && <> / {formatBRL(budget)}</>}
                </p>
              </div>
            </div>
          );
        })}
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
                className={`rounded-full px-3 py-1 transition ${
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

        {requests === null ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">Carregando…</p>
        ) : pending.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma solicitação pendente por aqui.
          </p>
        ) : (
          <ul>
            {pending.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setOpenRequest(r)}
                  className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-[var(--line)] px-5 py-3.5 text-left transition last:border-b-0 hover:bg-[var(--surface-2)] sm:grid-cols-[90px_1fr_110px_auto_120px_90px]"
                >
                  <span className="v-tabular text-xs font-semibold text-[var(--accent)]">
                    {r.display_id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.supplier_name}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {r.requester_email} · {r.cost_centers?.department}
                    </span>
                  </span>
                  <span className="hidden sm:block">
                    <TypeBadge type={r.request_type} />
                  </span>
                  <span className="text-right v-tabular text-sm font-bold">
                    {formatBRL(Number(r.total_amount))}
                  </span>
                  <span className="hidden text-right v-tabular text-xs text-[var(--muted)] sm:block">
                    {formatDate(r.created_at)}
                  </span>
                  <span className="hidden justify-self-end text-xs font-semibold text-[var(--accent)] sm:block">
                    Revisar →
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setOpenRequest(r)}
                  className="flex w-full items-center gap-4 border-b border-[var(--line)] px-5 py-3 text-left transition last:border-b-0 hover:bg-[var(--surface-2)]"
                >
                  <span className="v-tabular text-xs font-semibold text-[var(--accent)]">
                    {r.display_id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.supplier_name}</span>
                  <span className="hidden v-tabular text-xs text-[var(--muted)] sm:block">
                    {formatBRL(Number(r.total_amount))}
                  </span>
                  <StatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openRequest && (
        <RequestDrawer
          request={openRequest}
          viewerEmail={email}
          canDecide={openRequest.status === "pending"}
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pending" | "approved";
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
      <p className="v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
        {label}
      </p>
      <p
        className="mt-1.5 truncate v-tabular text-lg font-bold"
        style={tone ? { color: `var(--${tone})` } : undefined}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
