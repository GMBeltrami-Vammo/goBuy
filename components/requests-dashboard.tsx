"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NewFornecedorModal } from "@/components/new-fornecedor-modal";
import { NewRequestModal } from "@/components/new-request-modal";
import { Pagination, usePagination } from "@/components/pagination";
import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import {
  brtYmd,
  formatBRL,
  formatDate,
  formatDateOnlyBR,
  isInvalidDMY,
  maskDMY,
  parseDMY,
  STATUS_LABEL,
} from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, Fornecedor, PurchaseRequest } from "@/lib/types";

const IN_PROGRESS = ["approved", "awaiting_finance", "awaiting_payment"];

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
  const [statusFilter, setStatusFilter] = useState("all");
  const [ccFilter, setCcFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateField, setDateField] = useState<"created" | "payment">("created");
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

  // Cost centers present in the user's own requests, for the CC filter.
  const ccOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of requests ?? []) {
      if (r.cost_centers) map.set(r.cost_center_id, `${r.cost_centers.code} — ${r.cost_centers.name}`);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [requests]);

  const filtered = useMemo(() => {
    const fromYMD = parseDMY(dateFrom);
    const toYMD = parseDMY(dateTo);
    let list = requests ?? [];
    if (statusFilter === "in_progress") list = list.filter((r) => IN_PROGRESS.includes(r.status));
    else if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    if (ccFilter !== "all") list = list.filter((r) => String(r.cost_center_id) === ccFilter);
    if (fromYMD) {
      list = list.filter((r) => {
        const d = dateField === "created" ? brtYmd(r.created_at) : r.expected_payment_date ?? "";
        return !!d && d >= fromYMD;
      });
    }
    if (toYMD) {
      list = list.filter((r) => {
        const d = dateField === "created" ? brtYmd(r.created_at) : r.expected_payment_date ?? "";
        return !!d && d <= toYMD;
      });
    }
    return list;
  }, [requests, statusFilter, ccFilter, dateFrom, dateTo, dateField]);

  const { page, setPage, pageCount, pageItems, total, start, end } = usePagination(
    filtered,
    `${statusFilter}|${ccFilter}|${dateFrom}|${dateTo}|${dateField}`,
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5500);
  };

  const dateInvalid = isInvalidDMY(dateFrom) || isInvalidDMY(dateTo);
  const hasFilters = statusFilter !== "all" || ccFilter !== "all" || !!dateFrom || !!dateTo;
  const clearFilters = () => {
    setStatusFilter("all");
    setCcFilter("all");
    setDateFrom("");
    setDateTo("");
  };

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
          active={statusFilter === "pending"}
          onClick={() => setStatusFilter((s) => (s === "pending" ? "all" : "pending"))}
        />
        <SummaryCard
          label="Em andamento"
          value={summary ? String(summary.inProgress) : null}
          sub={summary ? formatBRL(summary.inProgressValue) : undefined}
          tone="accent"
          active={statusFilter === "in_progress"}
          onClick={() => setStatusFilter((s) => (s === "in_progress" ? "all" : "in_progress"))}
        />
        <SummaryCard
          label="Pagas"
          value={summary ? String(summary.paid) : null}
          sub={summary ? formatBRL(summary.paidValue) : undefined}
          tone="paid"
          active={statusFilter === "paid"}
          onClick={() => setStatusFilter((s) => (s === "paid" ? "all" : "paid"))}
        />
        <SummaryCard
          label="Total solicitado"
          value={summary ? formatBRL(summary.totalValue) : null}
          small
          active={statusFilter === "all" && !hasFilters}
          onClick={clearFilters}
        />
      </div>

      <div className="reveal reveal-3 mt-8 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
            Minhas solicitações
          </h2>
          <span className="v-tabular text-[11px] text-[var(--faint)]">
            {requests === null ? "—" : `${filtered.length} de ${requests.length}`}
          </span>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] px-5 py-2.5">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtrar por status"
            className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]"
          >
            <option value="all">Todos os status</option>
            <option value="pending">Aguardando</option>
            <option value="in_progress">Em andamento</option>
            <option value="approved">{STATUS_LABEL.approved}</option>
            <option value="awaiting_finance">{STATUS_LABEL.awaiting_finance}</option>
            <option value="awaiting_payment">{STATUS_LABEL.awaiting_payment}</option>
            <option value="paid">{STATUS_LABEL.paid}</option>
            <option value="rejected">{STATUS_LABEL.rejected}</option>
            <option value="cancelled">{STATUS_LABEL.cancelled}</option>
          </select>
          <select
            value={ccFilter}
            onChange={(e) => setCcFilter(e.target.value)}
            aria-label="Filtrar por centro de custo"
            className="max-w-48 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]"
          >
            <option value="all">Todos os centros de custo</option>
            {ccOptions.map(([id, label]) => (
              <option key={id} value={String(id)}>{label}</option>
            ))}
          </select>
          <div
            role="group"
            aria-label="Filtrar por data de solicitação ou pagamento"
            className="flex items-center gap-0.5 rounded-md border border-[var(--line)] p-0.5"
          >
            {(["created", "payment"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setDateField(f)}
                aria-pressed={dateField === f}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  dateField === f
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {f === "created" ? "Solicitação" : "Pagamento"}
              </button>
            ))}
          </div>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            placeholder="dd/mm/yyyy"
            value={dateFrom}
            onChange={(e) => setDateFrom(maskDMY(e.target.value))}
            aria-invalid={isInvalidDMY(dateFrom)}
            className={`w-24 rounded-md border bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)] ${
              isInvalidDMY(dateFrom) ? "border-[var(--rejected)]" : "border-[var(--line-strong)]"
            }`}
            aria-label="De (dd/mm/yyyy)"
          />
          <span className="text-[11px] text-[var(--faint)]">—</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            placeholder="dd/mm/yyyy"
            value={dateTo}
            onChange={(e) => setDateTo(maskDMY(e.target.value))}
            aria-invalid={isInvalidDMY(dateTo)}
            className={`w-24 rounded-md border bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)] ${
              isInvalidDMY(dateTo) ? "border-[var(--rejected)]" : "border-[var(--line-strong)]"
            }`}
            aria-label="Até (dd/mm/yyyy)"
          />
          {dateInvalid && (
            <span role="alert" className="text-[11px] text-[var(--rejected)]">
              Data inválida
            </span>
          )}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Limpar filtros
            </button>
          )}
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
        ) : filtered.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-[var(--faint)]">
            Nenhuma solicitação corresponde aos filtros.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Minhas solicitações de compra">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-[var(--line)]">
                  <th scope="col" className="w-[90px] px-5 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">ID</th>
                  <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Fornecedor</th>
                  <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Tipo</th>
                  <th scope="col" className="w-[110px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Valor</th>
                  <th scope="col" className="w-[90px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Dt. solicitação</th>
                  <th scope="col" className="w-[90px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Pag. previsto</th>
                  <th scope="col" className="w-[132px] px-5 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r) => {
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
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={page}
          pageCount={pageCount}
          onPage={setPage}
          total={total}
          start={start}
          end={end}
        />
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
