"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Pagination, usePagination } from "@/components/pagination";
import { formatBRL, formatDateOnlyBR } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { IncomingCharge } from "@/lib/types";

const CHARGE_STATUS_LABEL: Record<IncomingCharge["status"], string> = {
  pending: "Pendente",
  approved: "Aprovada",
  denied: "Recusada",
};
// Charge statuses map onto the shared status tokens (denied → rejected).
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

export function ChargesDashboard({
  email,
  supabaseToken,
}: {
  email: string;
  supabaseToken: string;
}) {
  const [charges, setCharges] = useState<IncomingCharge[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyTarget, setDenyTarget] = useState<IncomingCharge | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser(supabaseToken)
      .from("incoming_charges")
      .select("*, cost_centers(code, name, department)")
      .order("due_date", { ascending: true })
      .limit(500);
    setCharges((data as unknown as IncomingCharge[]) ?? []);
  }, [supabaseToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(
    () => (charges ?? []).filter((c) => c.status === "pending"),
    [charges],
  );
  const decided = useMemo(
    () => (charges ?? []).filter((c) => c.status !== "pending"),
    [charges],
  );

  const pendingPager = usePagination(pending, "pending");
  const decidedPager = usePagination(decided, "decided");

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
    if (!denyTarget || busyRef.current) return;
    if (!denyReason.trim()) return;
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

      {/* Pending queue */}
      <div className="reveal reveal-2 mt-7 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
            Aguardando sua decisão
          </h2>
        </div>

        {loading ? (
          <div role="status" aria-label="Carregando cobranças">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : pending.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma cobrança pendente por aqui.
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
                      <td className="px-5 py-3.5 v-tabular text-xs font-semibold text-[var(--accent)]">
                        {c.display_id}
                      </td>
                      <td className="px-2 py-3.5">
                        <div className="text-sm font-medium">{c.supplier_name}</div>
                        {c.nf_number && (
                          <div className="text-xs text-[var(--muted)]">NF {c.nf_number}</div>
                        )}
                        {c.description && (
                          <div className="max-w-[28ch] truncate text-xs text-[var(--muted)]" title={c.description}>
                            {c.description}
                          </div>
                        )}
                        <ChargeLinks charge={c} />
                      </td>
                      <td className="px-2 py-3.5">
                        <div className="text-xs font-medium">{c.cost_centers?.department ?? "—"}</div>
                        <div className="text-[11px] text-[var(--faint)]">
                          {c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : c.cost_center_id}
                        </div>
                        {c.pix_key && (
                          <div className="mt-0.5 text-[11px] text-[var(--muted)]">Pix: {c.pix_key}</div>
                        )}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-xs text-[var(--muted)]">
                        {c.due_date ? formatDateOnlyBR(c.due_date) : "—"}
                      </td>
                      <td className="px-2 py-3.5 text-right v-tabular text-sm font-bold">
                        {formatBRL(Number(c.amount))}
                      </td>
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
                    <td className="w-[80px] px-5 py-3 v-tabular text-xs font-semibold text-[var(--accent)]">
                      {c.display_id}
                    </td>
                    <td className="px-2 py-3">
                      <div className="text-sm">{c.supplier_name}</div>
                      <div className="text-[11px] text-[var(--faint)]">
                        {c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : c.cost_center_id}
                      </div>
                    </td>
                    <td className="hidden px-2 py-3 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                      {formatBRL(Number(c.amount))}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ChargeStatusBadge status={c.status} />
                    </td>
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
          message={`${denyTarget.supplier_name} — ${formatBRL(Number(denyTarget.amount))}. Informe o motivo da recusa.`}
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
        <a
          href={charge.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          NF / recibo ↗
        </a>
      )}
      {charge.boleto_url && (
        <a
          href={charge.boleto_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
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
