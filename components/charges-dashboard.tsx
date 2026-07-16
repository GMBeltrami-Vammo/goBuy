"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Pagination, usePagination } from "@/components/pagination";
import { formatBRL, formatDateOnlyBR } from "@/lib/format";
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
const COMMITTED_STATUSES = new Set<IncomingCharge["status"]>(["approved", "pending"]);

const CHARGE_STATUS_LABEL: Record<IncomingCharge["status"], string> = {
  pending: "Pendente",
  approved: "Aprovada",
  denied: "Recusada",
};
const CHARGE_STATUS_TONE: Record<IncomingCharge["status"], string> = {
  pending: "pending",
  approved: "approved",
  denied: "rejected",
};

function ChargeStatusBadge({ status }: { status: IncomingCharge["status"] }) {
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

export function ChargesDashboard({
  email,
  supabaseToken,
  centerIds,
  canResync = false,
}: {
  email: string;
  supabaseToken: string;
  centerIds: number[];
  canResync?: boolean;
}) {
  const [charges, setCharges] = useState<IncomingCharge[] | null>(null);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [budgets, setBudgets] = useState<CostCenterBudget[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyTarget, setDenyTarget] = useState<IncomingCharge | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [viewMode, setViewMode] = useState<"pizza" | "barra">("pizza");
  const [focusCc, setFocusCc] = useState<number | null>(null);
  const busyRef = useRef(false);

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  }, []);
  const [selectedMonth, setSelectedMonth] = useState(monthStart);

  const hasCenters = centerIds.length > 0;

  const load = useCallback(async () => {
    const supabase = supabaseBrowser(supabaseToken);
    const [chargeRes, ccRes, budgetRes] = await Promise.all([
      supabase
        .from("incoming_charges")
        .select("*, cost_centers(code, name, department)")
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

  // ─── Budget aggregation (committed = approved + pending, bucketed by due date) ──
  const ym = (d: string) => d.slice(0, 7); // "yyyy-mm"

  const committedByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of charges ?? []) {
      if (!COMMITTED_STATUSES.has(c.status) || !c.due_date) continue;
      if ((c.currency ?? "BRL") !== "BRL") continue; // budgets are in BRL — no FX
      if (ym(c.due_date) !== ym(selectedMonth)) continue;
      map.set(c.cost_center_id, (map.get(c.cost_center_id) ?? 0) + Number(c.amount));
    }
    return map;
  }, [charges, selectedMonth]);

  const pendingAmountByCenter = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of charges ?? []) {
      if (c.status !== "pending" || !c.due_date) continue;
      if ((c.currency ?? "BRL") !== "BRL") continue; // budgets are in BRL — no FX
      if (ym(c.due_date) !== ym(selectedMonth)) continue;
      map.set(c.cost_center_id, (map.get(c.cost_center_id) ?? 0) + Number(c.amount));
    }
    return map;
  }, [charges, selectedMonth]);

  // Approved/pending charges this month in a non-BRL currency — shown in the
  // queue but not summed into the BRL budget (we have no FX rates).
  const foreignThisMonth = useMemo(
    () =>
      (charges ?? []).filter(
        (c) =>
          COMMITTED_STATUSES.has(c.status) &&
          !!c.due_date &&
          ym(c.due_date) === ym(selectedMonth) &&
          (c.currency ?? "BRL") !== "BRL",
      ).length,
    [charges, selectedMonth],
  );

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
    const pending = centers.reduce((a, c) => a + (pendingAmountByCenter.get(c.id) ?? 0), 0);
    return { budget, committed, pending, available: Math.max(0, budget - committed) };
  }, [centers, budgetByCenter, committedByCenter, pendingAmountByCenter]);

  // Only show CCs that have a budget or activity this month (keeps the view
  // focused — a head of many CCs isn't flooded with empty cards).
  const relevantCenters = useMemo(
    () => centers.filter((c) => (budgetByCenter.get(c.id) ?? 0) > 0 || (committedByCenter.get(c.id) ?? 0) > 0),
    [centers, budgetByCenter, committedByCenter],
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

  const availableMonths = useMemo(() => {
    const set = new Set<string>(budgets.map((b) => b.period_month.slice(0, 10)));
    for (const c of charges ?? []) if (c.due_date) set.add(`${ym(c.due_date)}-01`);
    set.add(monthStart);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [budgets, charges, monthStart]);

  const monthName = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const isMockOrEmpty = hasCenters && budgets.length === 0;

  // ─── Charge queues (respecting the CC drill-down filter) ──────────────────────
  const inFocus = (c: IncomingCharge) => focusCc === null || c.cost_center_id === focusCc;
  const pending = useMemo(
    () => (charges ?? []).filter((c) => c.status === "pending" && inFocus(c)),
    [charges, focusCc],
  );
  const decided = useMemo(
    () => (charges ?? []).filter((c) => c.status !== "pending" && inFocus(c)),
    [charges, focusCc],
  );

  const pendingPager = usePagination(pending, `pending|${focusCc}`);
  const decidedPager = usePagination(decided, `decided|${focusCc}`);
  const focusLabel = focusCc !== null ? centers.find((c) => c.id === focusCc)?.code ?? null : null;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  const approve = async (c: IncomingCharge) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(c.id);
    const { error } = await supabaseBrowser(supabaseToken).rpc("decide_incoming_charge", {
      p_id: c.id,
      p_action: "approve",
      p_reason: null,
    });
    busyRef.current = false;
    setBusyId(null);
    if (error) {
      flash("Não foi possível aprovar. Atualize a página e tente novamente.");
      return;
    }
    flash(`${c.display_id} aprovada.`);
    void load();
  };

  const confirmDeny = async () => {
    if (!denyTarget || busyRef.current || !denyReason.trim()) return;
    busyRef.current = true;
    setBusyId(denyTarget.id);
    const { error } = await supabaseBrowser(supabaseToken).rpc("decide_incoming_charge", {
      p_id: denyTarget.id,
      p_action: "deny",
      p_reason: denyReason.trim(),
    });
    busyRef.current = false;
    setBusyId(null);
    const id = denyTarget.display_id;
    setDenyTarget(null);
    if (error) {
      flash("Não foi possível recusar. Atualize a página e tente novamente.");
      return;
    }
    flash(`${id} recusada.`);
    void load();
  };

  // Approved charges whose sheet write-back never landed (e.g. approved before
  // the webhook was deployed, or a transient failure). Admins can re-fire it.
  const stuckCount = useMemo(
    () =>
      (charges ?? []).filter(
        (c) => c.status === "approved" && !c.sheet_written_at && c.sheet_row != null,
      ).length,
    [charges],
  );

  const resync = async () => {
    const res = await fetch("/api/charges/resync", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      attempted?: number;
      written?: number;
      error?: string;
    };
    if (!res.ok) {
      flash(body.error ?? "Falha ao resincronizar a planilha.");
      return;
    }
    flash(`Planilha resincronizada: ${body.written ?? 0} de ${body.attempted ?? 0} cobrança(s).`);
    void load();
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
        <div className="flex items-center gap-2">
          {canResync && stuckCount > 0 && (
            <button
              onClick={() => void resync()}
              title="Reenviar à planilha as cobranças aprovadas que ainda não foram gravadas"
              className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Resincronizar planilha ({stuckCount})
            </button>
          )}
          {pending.length > 0 && (
            <span className="rounded-full bg-[var(--pending-soft)] px-4 py-1.5 v-tabular text-sm font-bold text-[var(--pending)]">
              {pending.length} pendente{pending.length === 1 ? "" : "s"}
            </span>
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
            <div className="mb-3 flex items-center gap-2">
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
                  Por centro de custo — {monthName(selectedMonth)}
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

              <HeadAggregateChart data={aggregateData} viewMode={viewMode} onOpenCenter={(cc) => setFocusCc(cc.id)} />

              {viewMode === "pizza" && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {relevantCenters.map((cc) => {
                    const budget = budgetByCenter.get(cc.id) ?? 0;
                    const consumed = committedByCenter.get(cc.id) ?? 0;
                    return (
                      <button
                        key={cc.id}
                        onClick={() => setFocusCc(cc.id)}
                        className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-[var(--shadow)] transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        title="Filtrar cobranças deste centro de custo"
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

      {/* Pending queue */}
      <div className="reveal reveal-4 mt-8 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
            Aguardando sua decisão
          </h2>
          {focusLabel && (
            <button
              onClick={() => setFocusCc(null)}
              className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Filtrando: {focusLabel} ✕
            </button>
          )}
        </div>

        {loading ? (
          <div role="status" aria-label="Carregando cobranças">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : pending.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma cobrança pendente {focusLabel ? "para este centro de custo" : "por aqui"}.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full" aria-label="Cobranças pendentes">
                <thead className="hidden sm:table-header-group">
                  <tr className="border-b border-[var(--line)]">
                    <th scope="col" className="w-[80px] px-5 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">ID</th>
                    <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Fornecedor</th>
                    <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Centro de custo</th>
                    <th scope="col" className="w-[100px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Vencimento</th>
                    <th scope="col" className="w-[110px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Valor</th>
                    <th scope="col" className="w-[180px] px-5 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPager.pageItems.map((c) => (
                    <tr key={c.id} className="border-b border-[var(--line)] last:border-b-0 align-top">
                      <td className="px-5 py-3.5 v-tabular text-xs font-semibold text-[var(--accent)]">{c.display_id}</td>
                      <td className="px-2 py-3.5">
                        <div className="text-sm font-medium">{c.supplier_name}</div>
                        {c.nf_number && <div className="text-xs text-[var(--muted)]">NF {c.nf_number}</div>}
                        {c.description && (
                          <div className="max-w-[28ch] truncate text-xs text-[var(--muted)]" title={c.description}>{c.description}</div>
                        )}
                        <ChargeLinks charge={c} />
                      </td>
                      <td className="px-2 py-3.5">
                        <div className="text-xs font-medium">{c.cost_centers?.department ?? "—"}</div>
                        <div className="text-[11px] text-[var(--faint)]">
                          {c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : c.cost_center_id}
                        </div>
                        {c.pix_key && <div className="mt-0.5 text-[11px] text-[var(--muted)]">Pix: {c.pix_key}</div>}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-xs text-[var(--muted)]">
                        {c.due_date ? formatDateOnlyBR(c.due_date) : "—"}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-sm font-bold">{fmtMoney(Number(c.amount), c.currency)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => void approve(c)}
                            disabled={busyId === c.id}
                            className="rounded-lg bg-[var(--approved)] px-3 py-1.5 text-xs font-bold text-[var(--on-status)] transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          >
                            {busyId === c.id ? "…" : "Aprovar"}
                          </button>
                          <button
                            onClick={() => { setDenyReason(""); setDenyTarget(c); }}
                            disabled={busyId === c.id}
                            className="rounded-lg border border-[var(--rejected)] px-3 py-1.5 text-xs font-bold text-[var(--rejected)] transition hover:bg-[var(--rejected-soft)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          >
                            Recusar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pendingPager.page}
              pageCount={pendingPager.pageCount}
              onPage={pendingPager.setPage}
              total={pendingPager.total}
              start={pendingPager.start}
              end={pendingPager.end}
            />
          </>
        )}
      </div>

      {/* Decided history */}
      {decided.length > 0 && (
        <div className="reveal mt-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
              Decididas
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Cobranças decididas">
              <tbody>
                {decidedPager.pageItems.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--line)] last:border-b-0">
                    <td className="w-[80px] px-5 py-3 v-tabular text-xs font-semibold text-[var(--accent)]">{c.display_id}</td>
                    <td className="px-2 py-3">
                      <div className="text-sm">{c.supplier_name}</div>
                      <div className="text-[11px] text-[var(--faint)]">
                        {c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : c.cost_center_id}
                      </div>
                    </td>
                    <td className="hidden px-2 py-3 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                      {fmtMoney(Number(c.amount), c.currency)}
                    </td>
                    <td className="px-5 py-3 text-right"><ChargeStatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={decidedPager.page}
            pageCount={decidedPager.pageCount}
            onPage={decidedPager.setPage}
            total={decidedPager.total}
            start={decidedPager.start}
            end={decidedPager.end}
          />
        </div>
      )}

      {denyTarget && (
        <ConfirmDialog
          title={`Recusar ${denyTarget.display_id}?`}
          message={`${denyTarget.supplier_name} — ${fmtMoney(Number(denyTarget.amount), denyTarget.currency)}. Informe o motivo da recusa.`}
          confirmLabel="Recusar cobrança"
          tone="danger"
          busy={busyId === denyTarget.id}
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
    </div>
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
