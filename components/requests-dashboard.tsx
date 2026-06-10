"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { NewRequestModal } from "@/components/new-request-modal";
import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { formatBRL, formatDate } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, PurchaseRequest } from "@/lib/types";

export function RequestsDashboard({
  email,
  firstName,
}: {
  email: string;
  firstName: string;
}) {
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [openRequest, setOpenRequest] = useState<PurchaseRequest | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [reqRes, ccRes] = await Promise.all([
      supabase
        .from("purchase_requests")
        .select("*, cost_centers(code, name, department)")
        .eq("requester_email", email)
        .order("created_at", { ascending: false }),
      supabase
        .from("cost_centers")
        .select("id, code, name, department, active")
        .eq("active", true)
        .order("department")
        .order("code"),
    ]);
    setRequests((reqRes.data as unknown as PurchaseRequest[]) ?? []);
    setCostCenters((ccRes.data as unknown as CostCenter[]) ?? []);
  }, [email]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const list = requests ?? [];
    const by = (s: string) => list.filter((r) => r.status === s);
    const sum = (rs: PurchaseRequest[]) => rs.reduce((a, r) => a + Number(r.total_amount), 0);
    return {
      pending: by("pending").length,
      approved: by("approved").length,
      approvedValue: sum(by("approved")),
      paid: by("paid").length,
      paidValue: sum(by("paid")),
      totalValue: sum(list.filter((r) => r.status !== "cancelled" && r.status !== "rejected")),
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
            Acompanhe suas solicitações de compra e envie documentos.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-black shadow-[var(--shadow)] transition hover:opacity-90"
        >
          + Nova solicitação
        </button>
      </div>

      {toast && (
        <p className="reveal mt-5 rounded-lg border border-[var(--approved)] bg-[var(--approved-soft)] px-4 py-2.5 text-sm text-[var(--approved)]">
          {toast}
        </p>
      )}

      <div className="reveal reveal-2 mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Pendentes" value={String(summary.pending)} tone="pending" />
        <SummaryCard
          label="Aprovadas"
          value={String(summary.approved)}
          sub={formatBRL(summary.approvedValue)}
          tone="approved"
        />
        <SummaryCard
          label="Pagas"
          value={String(summary.paid)}
          sub={formatBRL(summary.paidValue)}
          tone="paid"
        />
        <SummaryCard label="Total solicitado" value={formatBRL(summary.totalValue)} small />
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
          <p className="px-5 py-14 text-center text-sm text-[var(--muted)]">Carregando…</p>
        ) : requests.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-[var(--muted)]">Nenhuma solicitação por aqui ainda.</p>
            <button
              onClick={() => setShowNew(true)}
              className="mt-3 text-sm font-semibold text-[var(--accent)] hover:underline"
            >
              Criar a primeira →
            </button>
          </div>
        ) : (
          <ul>
            {requests.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setOpenRequest(r)}
                  className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-[var(--line)] px-5 py-3.5 text-left transition last:border-b-0 hover:bg-[var(--surface-2)] sm:grid-cols-[90px_1fr_auto_110px_90px_110px]"
                >
                  <span className="v-tabular text-xs font-semibold text-[var(--accent)]">
                    {r.display_id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.supplier_name}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {r.cost_centers?.department} · {r.cost_centers?.name}
                    </span>
                  </span>
                  <span className="hidden sm:block">
                    <TypeBadge type={r.request_type} />
                  </span>
                  <span className="hidden text-right v-tabular text-sm font-semibold sm:block">
                    {formatBRL(Number(r.total_amount))}
                  </span>
                  <span className="hidden text-right v-tabular text-xs text-[var(--muted)] sm:block">
                    {formatDate(r.created_at)}
                  </span>
                  <span className="justify-self-end">
                    <StatusBadge status={r.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
          request={openRequest}
          viewerEmail={email}
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

function SummaryCard({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pending" | "approved" | "paid";
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
      <p className="v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
        {label}
      </p>
      <p
        className={`mt-1.5 v-tabular font-bold ${small ? "text-lg" : "text-2xl"}`}
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 v-tabular text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}
