"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NewRequestModal } from "@/components/new-request-modal";
import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { formatBRL, formatDate } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, PurchaseRequest } from "@/lib/types";

export function RequestsDashboard({
  email,
  firstName,
  supabaseToken,
  initialCostCenters,
  autoOpenDisplayId,
}: {
  email: string;
  firstName: string;
  supabaseToken: string;
  initialCostCenters: CostCenter[];
  autoOpenDisplayId?: string;
}) {
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [costCenters] = useState<CostCenter[]>(initialCostCenters);
  const [openRequest, setOpenRequest] = useState<PurchaseRequest | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const autoOpened = useRef(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser(supabaseToken)
      .from("purchase_requests")
      .select("*, cost_centers(code, name, department)")
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
    const inProgress = byStatus("approved", "awaiting_finance", "awaiting_payment");
    return {
      pending: byStatus("pending").length,
      inProgress: inProgress.length,
      inProgressValue: sum(inProgress),
      paid: byStatus("paid").length,
      paidValue: sum(byStatus("paid")),
      totalValue: sum(requests),
    };
  }, [requests]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
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
        <button
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-black shadow-[var(--shadow)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          + Nova solicitação
        </button>
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
        <SummaryCard label="Aguardando" value={summary ? String(summary.pending) : null} tone="pending" />
        <SummaryCard
          label="Em andamento"
          value={summary ? String(summary.inProgress) : null}
          sub={summary ? formatBRL(summary.inProgressValue) : undefined}
          tone="accent"
        />
        <SummaryCard
          label="Pagas"
          value={summary ? String(summary.paid) : null}
          sub={summary ? formatBRL(summary.paidValue) : undefined}
          tone="paid"
        />
        <SummaryCard label="Total solicitado" value={summary ? formatBRL(summary.totalValue) : null} small />
      </div>

      <div className="reveal reveal-3 mt-8 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
            Minhas solicitações
          </h2>
          <span className="v-tabular text-[11px] text-[var(--faint)]">
            {requests?.length ?? "—"}
          </span>
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
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-[var(--line)]">
                  <th scope="col" className="w-[90px] px-5 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">
                    ID
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">
                    Fornecedor
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">
                    Tipo
                  </th>
                  <th scope="col" className="w-[110px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">
                    Valor
                  </th>
                  <th scope="col" className="w-[90px] px-2 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">
                    Data
                  </th>
                  <th scope="col" className="w-[132px] px-5 py-2.5 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
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
                    <td className="px-5 py-3.5 v-tabular text-xs font-semibold text-[var(--accent)]">
                      {r.display_id}
                    </td>
                    <td className="px-2 py-3.5">
                      <div className="text-sm font-medium">{r.supplier_name}</div>
                      <div className="truncate text-xs text-[var(--muted)]">
                        {r.cost_centers?.department} · {r.cost_centers?.name}
                      </div>
                    </td>
                    <td className="hidden px-2 py-3.5 sm:table-cell">
                      <TypeBadge type={r.request_type} />
                    </td>
                    <td className="hidden px-2 py-3.5 text-right v-tabular text-sm font-semibold sm:table-cell">
                      {formatBRL(Number(r.total_amount))}
                    </td>
                    <td className="hidden px-2 py-3.5 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <NewRequestModal
          costCenters={costCenters}
          onClose={() => setShowNew(false)}
          onSubmitted={(displayId) => {
            setShowNew(false);
            flash(`Solicitação ${displayId} enviada. O head do centro de custo será notificado.`);
            void load();
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

function SummaryCard({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string | null;
  sub?: string;
  tone?: "pending" | "approved" | "paid" | "accent";
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
      <p className="v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">{label}</p>
      {value === null ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded-md bg-[var(--surface-2)]" />
      ) : (
        <p
          className={`mt-1.5 v-tabular font-bold ${small ? "text-lg" : "text-2xl"}`}
          style={tone ? { color: `var(--${tone})` } : undefined}
        >
          {value}
        </p>
      )}
      {sub && value !== null && (
        <p className="mt-0.5 v-tabular text-xs text-[var(--muted)]">{sub}</p>
      )}
    </div>
  );
}
