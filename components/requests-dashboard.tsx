"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NewFornecedorModal } from "@/components/new-fornecedor-modal";
import { NewRequestModal } from "@/components/new-request-modal";
import { Pagination, usePagination } from "@/components/pagination";
import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { FilterHeader, type FilterOption } from "@/components/table-filter";
import { useSort } from "@/components/table-sort";
import {
  formatBRL,
  formatDate,
  formatDateOnlyBR,
  STATUS_LABEL,
  TYPE_LABEL,
} from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, Fornecedor, PurchaseRequest, RequestStatus, RequestType } from "@/lib/types";

// "Em andamento" groups the three between-approval-and-payment statuses.
const IN_PROGRESS: RequestStatus[] = ["approved", "awaiting_finance", "awaiting_payment"];

// ─── Sorting & search ─────────────────────────────────────────────────────────
type SortField = "id" | "supplier" | "type" | "amount" | "created" | "payment" | "status";

// Status values in workflow order (drives the Status column's value filter).
const STATUS_ORDER: RequestStatus[] = [
  "pending",
  "approved",
  "awaiting_finance",
  "awaiting_payment",
  "paid",
  "rejected",
  "cancelled",
];
// Sort rank so the Status column orders sensibly (workflow order, actionable first).
const STATUS_RANK: Record<RequestStatus, number> = {
  pending: 0,
  approved: 1,
  awaiting_finance: 2,
  awaiting_payment: 3,
  paid: 4,
  rejected: 5,
  cancelled: 6,
};
const TYPE_ORDER: RequestType[] = ["products", "service", "advance"];

function requestSortKey(r: PurchaseRequest, field: SortField): string | number {
  switch (field) {
    case "id":
      return r.display_id ?? "";
    case "supplier":
      return (r.supplier_name ?? "").toLowerCase();
    case "type":
      return TYPE_LABEL[r.request_type] ?? "";
    case "amount":
      return Number(r.total_amount) || 0;
    case "created":
      return r.created_at ?? "";
    case "payment":
      return r.expected_payment_date ?? "";
    case "status":
      return STATUS_RANK[r.status];
  }
}

function compareRequests(a: PurchaseRequest, b: PurchaseRequest, field: SortField, dir: "asc" | "desc"): number {
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

// Free-text match across the fields shown in the row (incl. cost-center text, so
// CC stays discoverable via search).
function matchesRequestSearch(r: PurchaseRequest, q: string): boolean {
  return [r.display_id, r.supplier_name, r.cost_centers?.code, r.cost_centers?.name, r.cost_centers?.department]
    .some((v) => (v ?? "").toString().toLowerCase().includes(q));
}

export function RequestsDashboard({
  email,
  firstName,
  supabaseToken,
  initialCostCenters,
  initialFornecedores,
  autoOpenDisplayId,
}: {
  email: string;
  firstName: string;
  supabaseToken: string;
  initialCostCenters: CostCenter[];
  initialFornecedores: Fornecedor[];
  autoOpenDisplayId?: string;
}) {
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [costCenters] = useState<CostCenter[]>(initialCostCenters);
  const [fornecedores] = useState<Fornecedor[]>(initialFornecedores);
  const [openRequest, setOpenRequest] = useState<PurchaseRequest | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showNewForn, setShowNewForn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Table controls: global search + per-column value filters (excluded = the
  // unchecked values) + column sort.
  const [search, setSearch] = useState("");
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({});
  const { field: sortField, dir: sortDir, setSort } = useSort<SortField>("created", "desc");
  const autoOpened = useRef(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser(supabaseToken)
      .from("purchase_requests")
      .select("*, cost_centers(code, name, department, cost_center_heads(head_name, head_email))")
      .eq("requester_email", email)
      .order("created_at", { ascending: false });
    setRequests((data as unknown as PurchaseRequest[]) ?? []);
  }, [email, supabaseToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoOpenDisplayId || autoOpened.current || !requests) return;
    const match = requests.find((r) => r.display_id === autoOpenDisplayId);
    if (match) {
      autoOpened.current = true;
      setOpenRequest(match);
    }
  }, [autoOpenDisplayId, requests]);

  // summary is null while requests are still loading → cards show skeletons.
  // "Em andamento" covers approved + awaiting_finance + awaiting_payment.
  // totalValue includes ALL requests (honest total — no silent exclusions).
  const summary = useMemo(() => {
    if (requests === null) return null;
    const byStatus = (...ss: string[]) => requests.filter((r) => ss.includes(r.status));
    const sum = (rs: PurchaseRequest[]) => rs.reduce((a, r) => a + Number(r.total_amount), 0);
    const inProgress = byStatus(...IN_PROGRESS);
    return {
      pending: byStatus("pending").length,
      inProgress: inProgress.length,
      inProgressValue: sum(inProgress),
      paid: byStatus("paid").length,
      paidValue: sum(byStatus("paid")),
      totalValue: sum(requests),
    };
  }, [requests]);

  const searchQ = search.trim().toLowerCase();

  // Distinct values present, for each filterable column's dropdown.
  const filterOptions = useMemo(() => {
    const supplier = new Map<string, string>();
    for (const r of requests ?? []) supplier.set(r.supplier_name ?? "", r.supplier_name ?? "");
    const supplierOpts: FilterOption[] = [...supplier.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => (a.value === "" ? 1 : b.value === "" ? -1 : a.label.localeCompare(b.label)));
    const presentTypes = new Set((requests ?? []).map((r) => r.request_type));
    const type: FilterOption[] = TYPE_ORDER.filter((t) => presentTypes.has(t)).map((t) => ({
      value: t,
      label: TYPE_LABEL[t],
    }));
    const presentStatus = new Set((requests ?? []).map((r) => r.status));
    const status: FilterOption[] = STATUS_ORDER.filter((s) => presentStatus.has(s)).map((s) => ({
      value: s,
      label: STATUS_LABEL[s],
    }));
    return { supplier: supplierOpts, type, status };
  }, [requests]);

  const rows = useMemo(() => {
    const list = (requests ?? []).filter((r) => {
      if (searchQ && !matchesRequestSearch(r, searchQ)) return false;
      if (excluded.supplier?.has(r.supplier_name ?? "")) return false;
      if (excluded.type?.has(r.request_type)) return false;
      if (excluded.status?.has(r.status)) return false;
      return true;
    });
    return [...list].sort((a, b) => compareRequests(a, b, sortField, sortDir));
  }, [requests, excluded, searchQ, sortField, sortDir]);

  const excludedKey = Object.entries(excluded)
    .map(([k, s]) => `${k}:${[...s].sort().join("|")}`)
    .sort()
    .join(";");
  const { page, setPage, pageCount, pageItems, total, start, end } = usePagination(
    rows,
    `${excludedKey}|${searchQ}|${sortField}|${sortDir}`,
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5500);
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

  const anyFilter = !!searchQ || Object.values(excluded).some((s) => s.size > 0);
  const clearFilters = () => {
    setSearch("");
    setExcluded({});
  };

  // The summary cards act as quick presets over the Status column's value
  // filter: "show only these statuses" = exclude every other status.
  const statusFilterIs = (show: RequestStatus[]) => {
    const ex = excluded.status;
    if (!ex || ex.size === 0) return false;
    const target = STATUS_ORDER.filter((s) => !show.includes(s));
    return ex.size === target.length && target.every((s) => ex.has(s));
  };
  const toggleStatusOnly = (show: RequestStatus[]) =>
    statusFilterIs(show)
      ? selectAllVals("status")
      : setExcluded((prev) => ({ ...prev, status: new Set(STATUS_ORDER.filter((s) => !show.includes(s))) }));

  return (
    <div>
      <div className="reveal reveal-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Olá, {firstName}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Acompanhe e gerencie suas solicitações de compra.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowNewForn(true)}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            + Adicionar novo fornecedor
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-black shadow-[var(--shadow)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            + Nova solicitação
          </button>
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

      <div className="reveal reveal-2 mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Aguardando"
          value={summary ? String(summary.pending) : null}
          tone="pending"
          active={statusFilterIs(["pending"])}
          onClick={() => toggleStatusOnly(["pending"])}
        />
        <SummaryCard
          label="Em andamento"
          value={summary ? String(summary.inProgress) : null}
          sub={summary ? formatBRL(summary.inProgressValue) : undefined}
          tone="accent"
          active={statusFilterIs(IN_PROGRESS)}
          onClick={() => toggleStatusOnly(IN_PROGRESS)}
        />
        <SummaryCard
          label="Pagas"
          value={summary ? String(summary.paid) : null}
          sub={summary ? formatBRL(summary.paidValue) : undefined}
          tone="paid"
          active={statusFilterIs(["paid"])}
          onClick={() => toggleStatusOnly(["paid"])}
        />
        <SummaryCard
          label="Total solicitado"
          value={summary ? formatBRL(summary.totalValue) : null}
          small
          active={!anyFilter}
          onClick={clearFilters}
        />
      </div>

      <div className="reveal reveal-3 mt-8 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
              Minhas solicitações
            </h2>
            <span className="hidden v-tabular text-[10px] text-[var(--faint)] sm:inline">
              ordene/filtre clicando nos cabeçalhos
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="v-tabular text-[11px] text-[var(--faint)]">
              {requests === null ? "—" : `${rows.length} de ${requests.length}`}
            </span>
            {anyFilter && (
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
              placeholder="Buscar fornecedor, CC, ID…"
              aria-label="Buscar nas solicitações"
              className="w-48 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1 text-[11px] text-[var(--ink)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)] sm:w-56"
            />
          </div>
        </div>

        {requests === null ? (
          <div role="status" aria-label="Carregando solicitações">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : requests.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-[var(--muted)]">Nenhuma solicitação por aqui ainda.</p>
            <button
              onClick={() => setShowNew(true)}
              className="mt-3 text-sm font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Criar a primeira →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Minhas solicitações de compra">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <FilterHeader label="ID" field="id" active={sortField} dir={sortDir} setSort={setSort} width="90px" className="pl-5" />
                  <FilterHeader
                    label="Fornecedor" field="supplier" active={sortField} dir={sortDir} setSort={setSort}
                    options={filterOptions.supplier} excluded={excluded.supplier}
                    onToggle={(v) => toggleVal("supplier", v)} onSelectAll={() => selectAllVals("supplier")} onClearAll={() => clearVals("supplier", filterOptions.supplier)}
                  />
                  <FilterHeader
                    label="Tipo" field="type" active={sortField} dir={sortDir} setSort={setSort} className="hidden sm:table-cell"
                    options={filterOptions.type} excluded={excluded.type}
                    onToggle={(v) => toggleVal("type", v)} onSelectAll={() => selectAllVals("type")} onClearAll={() => clearVals("type", filterOptions.type)}
                  />
                  <FilterHeader label="Valor" field="amount" active={sortField} dir={sortDir} setSort={setSort} align="right" width="110px" className="hidden sm:table-cell" />
                  <FilterHeader label="Dt. solicitação" field="created" active={sortField} dir={sortDir} setSort={setSort} align="right" width="90px" className="hidden sm:table-cell" />
                  <FilterHeader label="Pag. previsto" field="payment" active={sortField} dir={sortDir} setSort={setSort} align="right" width="90px" className="hidden sm:table-cell" />
                  <FilterHeader
                    label="Status" field="status" active={sortField} dir={sortDir} setSort={setSort} align="right" width="132px" className="pr-5"
                    options={filterOptions.status} excluded={excluded.status}
                    onToggle={(v) => toggleVal("status", v)} onSelectAll={() => selectAllVals("status")} onClearAll={() => clearVals("status", filterOptions.status)}
                  />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-[var(--faint)]">
                      Nenhuma solicitação corresponde aos filtros.
                    </td>
                  </tr>
                ) : (
                  pageItems.map((r) => {
                  const heads = (r.cost_centers?.cost_center_heads ?? [])
                    .map((h) => h.head_name ?? h.head_email.split("@")[0])
                    .join(", ");
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
                      aria-label={`Solicitação ${r.display_id} — ${r.supplier_name}`}
                    >
                      <td className="px-5 py-3.5 align-top v-tabular text-xs font-semibold text-[var(--accent)]">
                        {r.display_id}
                      </td>
                      <td className="px-2 py-3.5 align-top">
                        <div className="text-sm font-medium">{r.supplier_name}</div>
                        <div className="truncate text-xs text-[var(--muted)]">
                          {r.cost_centers?.department} · {r.cost_centers?.name}
                        </div>
                        {heads && (
                          <div className="truncate text-[10px] text-[var(--faint)]">Head: {heads}</div>
                        )}
                      </td>
                      <td className="hidden px-2 py-3.5 align-top sm:table-cell">
                        <TypeBadge type={r.request_type} />
                      </td>
                      <td className="hidden px-2 py-3.5 text-right align-top v-tabular text-sm font-semibold sm:table-cell">
                        {formatBRL(Number(r.total_amount))}
                      </td>
                      <td className="hidden px-2 py-3.5 text-right align-top v-tabular text-xs text-[var(--muted)] sm:table-cell">
                        {formatDate(r.created_at)}
                      </td>
                      <td className="hidden px-2 py-3.5 text-right align-top v-tabular text-xs text-[var(--muted)] sm:table-cell">
                        {r.expected_payment_date ? formatDateOnlyBR(r.expected_payment_date) : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right align-top">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })
                )}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <Pagination
            page={page}
            pageCount={pageCount}
            onPage={setPage}
            total={total}
            start={start}
            end={end}
          />
        )}
      </div>

      {showNew && (
        <NewRequestModal
          costCenters={costCenters}
          fornecedores={fornecedores}
          supabaseToken={supabaseToken}
          onClose={() => setShowNew(false)}
          onSubmitted={(displayId, note) => {
            setShowNew(false);
            flash(
              `Solicitação ${displayId} enviada. O head do centro de custo será notificado.` +
                (note ? ` ${note}` : ""),
            );
            void load();
          }}
        />
      )}

      {showNewForn && (
        <NewFornecedorModal
          costCenters={costCenters}
          supabaseToken={supabaseToken}
          onClose={() => setShowNewForn(false)}
          onCreated={(name) => {
            setShowNewForn(false);
            flash(`Fornecedor "${name}" cadastrado — disponível para solicitações após aprovação do Financeiro.`);
          }}
        />
      )}

      {openRequest && (
        <RequestDrawer
          key={openRequest.id}
          request={openRequest}
          viewerEmail={email}
          supabaseToken={supabaseToken}
          canDecide={false}
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

const TONE_CLASS: Record<"pending" | "approved" | "paid" | "accent", string> = {
  pending: "text-[var(--pending)]",
  approved: "text-[var(--approved)]",
  paid: "text-[var(--paid)]",
  accent: "text-[var(--accent)]",
};

function SummaryCard({
  label,
  value,
  sub,
  tone,
  small,
  active,
  onClick,
}: {
  label: string;
  value: string | null;
  sub?: string;
  tone?: "pending" | "approved" | "paid" | "accent";
  small?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const loading = value === null;
  return (
    <button
      type="button"
      onClick={loading ? undefined : onClick}
      aria-pressed={active}
      disabled={loading}
      className={`rounded-xl border bg-[var(--surface)] p-4 text-left shadow-[var(--shadow)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        active ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--line)] hover:border-[var(--line-strong)]"
      } ${loading ? "cursor-default" : "cursor-pointer"}`}
    >
      <p className="v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded-md bg-[var(--surface-2)]" />
      ) : (
        <p
          className={`mt-1.5 v-tabular font-bold ${small ? "text-lg" : "text-2xl"} ${tone ? TONE_CLASS[tone] : ""}`}
        >
          {value}
        </p>
      )}
      {sub && !loading && <p className="mt-0.5 v-tabular text-xs text-[var(--muted)]">{sub}</p>}
    </button>
  );
}
