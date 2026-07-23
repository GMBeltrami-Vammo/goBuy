"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChargeDetailModal } from "@/components/charge-detail-modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FeriasDialog } from "@/components/ferias-dialog";
import { Pagination, usePagination } from "@/components/pagination";
import { RateioLine } from "@/components/rateio-line";
import { chargeContributions } from "@/lib/rateio";
import { brtDateTimeBR, brtYmd, formatBRL, formatDateOnlyBR, isInvalidDMY, maskDMY, parseDMY } from "@/lib/format";
import { paymentSchedule } from "@/lib/payment-schedule";
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

const CHARGE_STATUS_LABEL: Record<IncomingCharge["status"], string> = {
  pending: "Pendente",
  approved: "Aprovada",
  denied: "Recusada",
  reclassifying: "Em mudança de CC",
};
const CHARGE_STATUS_TONE: Record<IncomingCharge["status"], string> = {
  pending: "pending",
  approved: "approved",
  denied: "rejected",
  reclassifying: "pending",
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

// ─── Pending-queue sorting & search ───────────────────────────────────────────
type SortField = "due" | "request" | "payment" | "amount" | "supplier" | "cc";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "pending" | "reclassifying";

const SORT_LABELS: Record<SortField, string> = {
  due: "Vencimento",
  request: "Data da solicitação",
  payment: "Data de pagamento",
  amount: "Valor",
  supplier: "Fornecedor",
  cc: "Centro de custo",
};

// The value a charge sorts on for a given field. Dates are yyyy-mm-dd (or ISO for
// request_date) so lexicographic order is chronological; amount is numeric.
// "" marks a missing key so it can be pushed to the end regardless of direction.
function chargeSortKey(c: IncomingCharge, field: SortField): string | number {
  switch (field) {
    case "due":
      // Vencimento = day before the payment date (derived from the API date).
      return paymentSchedule(c.due_date).vencimento ?? "";
    case "request":
      return c.request_date ?? "";
    case "payment":
      return paymentSchedule(c.due_date).paymentDate ?? "";
    case "amount":
      return Number(c.amount) || 0;
    case "supplier":
      return (c.supplier_name ?? "").toLowerCase();
    case "cc":
      return c.cost_centers?.code ?? "";
  }
}

function compareCharges(a: IncomingCharge, b: IncomingCharge, field: SortField, dir: SortDir): number {
  const ka = chargeSortKey(a, field);
  const kb = chargeSortKey(b, field);
  // Missing keys ("") always sort last, in both directions.
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
  /** Real head (not a pure substitute) → may delegate their approvals (Férias). */
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
  const [selectedCcs, setSelectedCcs] = useState<Set<number>>(new Set());
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  // Pending-queue search / status filter / sort (default: Vencimento ascending,
  // matching the load order).
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Per-head Slack notification preference (null = still loading; default off).
  const [slackOn, setSlackOn] = useState<boolean | null>(null);
  const [slackBusy, setSlackBusy] = useState(false);
  // Reclassification request modal (head → proposes an optional target CC).
  const [reclassTarget, setReclassTarget] = useState<IncomingCharge | null>(null);
  const [reclassProposedCc, setReclassProposedCc] = useState("");
  // Férias — delegate approvals to a substitute for a date window.
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
  // Today's BRT calendar date — a Vencimento before it is overdue; also the basis
  // for the projected payment date (used in the table and the payment-date sort).
  const todayYmd = brtYmd(new Date().toISOString());

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

  // The CC multi-select scopes BOTH the graphs and the tables. Empty = all.
  const isVisible = (id: number) => selectedCcs.size === 0 || selectedCcs.has(id);
  const selKey = [...selectedCcs].sort((a, b) => a - b).join(",");

  // ─── Budget aggregation (committed = approved + pending BRL, by due date) ──────
  const ym = (d: string) => d.slice(0, 7); // "yyyy-mm"

  // Map CC code → id so rateio segments (which carry codes) attribute to the
  // right center. Only the viewer's CCs are mappable (RLS scopes the rest).
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

  // Graphs show CCs that are visible (per the filter) AND have budget or activity.
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

  // CCs that actually have charges — the list offered in the multi-select filter.
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

  // ─── Charge queues (scoped by the multi-select filter) ────────────────────────
  const dueFromYMD = parseDMY(dueFrom);
  const dueToYMD = parseDMY(dueTo);
  const inDueRange = (c: IncomingCharge) => {
    if (dueFromYMD && (!c.due_date || c.due_date < dueFromYMD)) return false;
    if (dueToYMD && (!c.due_date || c.due_date > dueToYMD)) return false;
    return true;
  };
  const dateInvalid = isInvalidDMY(dueFrom) || isInvalidDMY(dueTo);
  const searchQ = search.trim().toLowerCase();
  const anyTableFilter = selectedCcs.size > 0 || !!dueFrom || !!dueTo || !!searchQ || statusFilter !== "all";

  // The queue shows pending charges AND those in reclassification (blocked, but
  // still the head's to track). Filtered by CC, Vencimento range, status and free
  // text, then sorted by the chosen field/direction. Decididas = only approved/denied.
  const pending = useMemo(
    () => {
      const list = (charges ?? []).filter(
        (c) =>
          (c.status === "pending" || c.status === "reclassifying") &&
          isVisible(c.cost_center_id) &&
          inDueRange(c) &&
          (statusFilter === "all" || c.status === statusFilter) &&
          (searchQ === "" || matchesChargeSearch(c, searchQ)),
      );
      return list.sort((a, b) => compareCharges(a, b, sortField, sortDir));
    },
    [charges, selKey, dueFrom, dueTo, searchQ, statusFilter, sortField, sortDir],
  );
  const decided = useMemo(
    () =>
      (charges ?? []).filter(
        (c) => (c.status === "approved" || c.status === "denied") && isVisible(c.cost_center_id) && inDueRange(c),
      ),
    [charges, selKey, dueFrom, dueTo],
  );

  const pendingPager = usePagination(
    pending,
    `pending|${selKey}|${dueFrom}|${dueTo}|${searchQ}|${statusFilter}|${sortField}|${sortDir}`,
  );
  const decidedPager = usePagination(decided, `decided|${selKey}|${dueFrom}|${dueTo}`);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  // Decide via the API route (not the RPC directly): the route runs the
  // Google-Sheet write-back inline on approval and returns its outcome, so a
  // failed sheet write is visible instead of silently skipped.
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
      const body = (await res.json().catch(() => ({}))) as {
        sheet?: { ok: boolean };
      };
      return { ok: true, sheetFailed: body.sheet?.ok === false };
    } catch {
      return { ok: false, sheetFailed: false };
    }
  };

  // Optimistic decision: update the UI instantly (the charge moves to Decididas
  // right away) and run the server call — including the Sheet write-back — in
  // the background. On failure we roll the row back to its prior state. This
  // keeps the queue responsive: you can approve the next charge immediately,
  // without waiting for the previous webhook round-trip.
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
        // Roll the row back to exactly what it was.
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
    setDenyTarget(null); // close the dialog immediately; the write runs in the background
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

  // Optimistic: mark as "Em mudança de CC" and request reclassification. On
  // success the head loses the approve/deny buttons; a reclassifier assigns the
  // new CC and it returns to the (new) head as pending.
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

  // All active CCs grouped by department, for the reclassification proposal.
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

  // Load this head's Slack preference (RLS lets them read their own row).
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
    setSlackOn(next); // optimistic
    const { error } = await supabaseBrowser(supabaseToken).rpc("set_slack_pref", { p_enabled: next });
    setSlackBusy(false);
    if (error) {
      setSlackOn(!next); // revert
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
              Férias
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
          {pending.length > 0 && (
            <button
              onClick={() => queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              title="Ir para a fila de aprovação"
              className="rounded-full bg-[var(--pending-soft)] px-4 py-1.5 v-tabular text-sm font-bold text-[var(--pending)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {pending.length} pendente{pending.length === 1 ? "" : "s"} ↓
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

      {/* Pending queue */}
      <div ref={queueRef} className="reveal reveal-4 mt-8 scroll-mt-4 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="space-y-2.5 border-b border-[var(--line)] px-5 py-3">
          <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
            Aguardando sua decisão
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar fornecedor, NF, ID…"
              aria-label="Buscar nas cobranças pendentes"
              className="w-52 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1 text-[11px] text-[var(--ink)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
            />
            <CcMultiSelect
              centers={filterableCenters}
              selected={selectedCcs}
              onToggle={toggleCc}
              onClear={() => setSelectedCcs(new Set())}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filtrar por status"
              className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] font-medium text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="all">Todas</option>
              <option value="pending">Pendentes</option>
              <option value="reclassifying">Em mudança de CC</option>
            </select>
            <span className="ml-1 v-tabular text-[10px] uppercase tracking-[0.15em] text-[var(--faint)]">Venc.</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              placeholder="dd/mm/yyyy"
              value={dueFrom}
              onChange={(e) => setDueFrom(maskDMY(e.target.value))}
              aria-invalid={isInvalidDMY(dueFrom)}
              aria-label="Vencimento de (dd/mm/yyyy)"
              className={`w-24 rounded-md border bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)] ${
                isInvalidDMY(dueFrom) ? "border-[var(--rejected)]" : "border-[var(--line-strong)]"
              }`}
            />
            <span className="text-[11px] text-[var(--faint)]">—</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              placeholder="dd/mm/yyyy"
              value={dueTo}
              onChange={(e) => setDueTo(maskDMY(e.target.value))}
              aria-invalid={isInvalidDMY(dueTo)}
              aria-label="Vencimento até (dd/mm/yyyy)"
              className={`w-24 rounded-md border bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)] ${
                isInvalidDMY(dueTo) ? "border-[var(--rejected)]" : "border-[var(--line-strong)]"
              }`}
            />
            {dateInvalid && (
              <span role="alert" className="text-[11px] text-[var(--rejected)]">Data inválida</span>
            )}
            {anyTableFilter && (
              <button
                onClick={() => {
                  setSelectedCcs(new Set());
                  setDueFrom("");
                  setDueTo("");
                  setSearch("");
                  setStatusFilter("all");
                }}
                className="ml-1 rounded text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Limpar filtros
              </button>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <label htmlFor="pending-sort" className="v-tabular text-[10px] uppercase tracking-[0.15em] text-[var(--faint)]">
                Ordenar por
              </label>
              <select
                id="pending-sort"
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                aria-label="Ordenar cobranças por"
                className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] font-medium text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              >
                {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
                  <option key={f} value={f}>{SORT_LABELS[f]}</option>
                ))}
              </select>
              <button
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                aria-label={sortDir === "asc" ? "Ordem crescente (toque para inverter)" : "Ordem decrescente (toque para inverter)"}
                title={sortDir === "asc" ? "Crescente — toque para inverter" : "Decrescente — toque para inverter"}
                className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] font-bold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {sortDir === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div role="status" aria-label="Carregando cobranças">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : pending.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma cobrança pendente {anyTableFilter ? "com os filtros atuais" : "por aqui"}.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full" aria-label="Cobranças pendentes">
                <thead className="hidden sm:table-header-group">
                  <tr className="border-b border-[var(--line)]">
                    <th scope="col" className="w-[80px] px-5 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">ID</th>
                    <th scope="col" className="w-[120px] px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Data da solicitação</th>
                    <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Fornecedor</th>
                    <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Centro de custo</th>
                    <th scope="col" className="w-[100px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Aprovar até</th>
                    <th scope="col" className="w-[110px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Data de pagamento</th>
                    <th scope="col" className="w-[110px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Valor</th>
                    <th scope="col" className="w-[220px] px-5 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPager.pageItems.map((c) => (
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
                          // Vencimento ("aprovar até") = the day before the payment date
                          // (last day to approve and still hit that payment). Red-struck
                          // once it has passed.
                          const { vencimento } = paymentSchedule(c.due_date);
                          if (!vencimento) return <span className="text-[var(--muted)]">—</span>;
                          const overdue = vencimento < todayYmd;
                          return (
                            <div
                              className={overdue ? "text-[var(--rejected)] line-through" : "text-[var(--ink)]"}
                              title="Último dia para aprovar e manter o pagamento na data prevista."
                            >
                              {formatDateOnlyBR(vencimento)}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-xs text-[var(--ink)]">
                        {(() => {
                          // Payment date = the API date snapped to a Tue/Fri. The raw date
                          // that came from the API is shown beneath, flagged when adjusted.
                          const s = paymentSchedule(c.due_date);
                          if (!s.paymentDate) return <span className="text-[var(--muted)]">—</span>;
                          return (
                            <>
                              <div>{formatDateOnlyBR(s.paymentDate)}</div>
                              {s.apiDate && (
                                <div
                                  className="mt-0.5 text-[11px] text-[var(--faint)]"
                                  title={
                                    s.adjusted
                                      ? "Data recebida da API — ajustada para o próximo dia de pagamento (ter/sex)."
                                      : "Data recebida da API."
                                  }
                                >
                                  API {formatDateOnlyBR(s.apiDate)}
                                  {s.adjusted ? " ⟶ ajust." : ""}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-sm font-bold">{fmtMoney(Number(c.amount), c.currency)}</td>
                      <td className="px-5 py-3.5">
                        {c.status === "reclassifying" ? (
                          <div className="flex justify-end">
                            <ChargeStatusBadge status="reclassifying" />
                          </div>
                        ) : (
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
                        )}
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
                    <td className="hidden px-2 py-3 v-tabular text-[11px] text-[var(--muted)] sm:table-cell">
                      {c.request_date ? brtDateTimeBR(c.request_date) : "—"}
                    </td>
                    <td className="px-2 py-3">
                      <div className="text-sm">{c.supplier_name}</div>
                      <div className="text-[11px] text-[var(--faint)]">
                        {c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : c.cost_center_id}
                      </div>
                      {c.decided_at && (
                        <div className="mt-0.5 v-tabular text-[11px] text-[var(--muted)]">
                          {c.status === "approved" ? "Aprovada" : "Recusada"} em {brtDateTimeBR(c.decided_at)}
                        </div>
                      )}
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
  if (centers.length === 0) return null;
  const label =
    selected.size === 0 ? "todos" : `${selected.size} de ${centers.length}`;
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        Centros: {label} <span className="text-[var(--faint)]">▾</span>
      </summary>
      <div className="absolute z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[var(--shadow)]">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">
            {centers.length} com cobranças
          </span>
          {selected.size > 0 && (
            <button onClick={onClear} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">
              Limpar
            </button>
          )}
        </div>
        {centers.map((cc) => (
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
        ))}
      </div>
    </details>
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
