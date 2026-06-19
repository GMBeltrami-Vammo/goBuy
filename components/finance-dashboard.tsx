"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { formatBRL, formatDate, formatDateOnlyBR, STATUS_LABEL, TYPE_LABEL } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { PurchaseRequest } from "@/lib/types";

export function FinanceDashboard({
  email,
  canMarkPaid,
  supabaseToken,
  autoOpenDisplayId,
}: {
  email: string;
  canMarkPaid: boolean;
  supabaseToken: string;
  autoOpenDisplayId?: string;
}) {
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [openRequest, setOpenRequest] = useState<PurchaseRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateField, setDateField] = useState<"created" | "payment">("created");
  const autoOpened = useRef(false);

  useEffect(() => {
    if (!autoOpenDisplayId || autoOpened.current || !requests) return;
    const match = requests.find((r) => r.display_id === autoOpenDisplayId);
    if (match) {
      autoOpened.current = true;
      setOpenRequest(match);
    }
  }, [autoOpenDisplayId, requests]);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser(supabaseToken)
      .from("purchase_requests")
      .select("*, cost_centers(code, name, department, cost_center_heads(head_name, head_email))")
      .order("created_at", { ascending: false })
      .limit(1000);
    setRequests((data as unknown as PurchaseRequest[]) ?? []);
  }, [supabaseToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const departments = useMemo(
    () =>
      [...new Set((requests ?? []).map((r) => r.cost_centers?.department).filter(Boolean))].sort() as string[],
    [requests],
  );

  const filtered = useMemo(() => {
    let list = requests ?? [];
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    if (typeFilter !== "all") list = list.filter((r) => r.request_type === typeFilter);
    if (deptFilter !== "all") list = list.filter((r) => r.cost_centers?.department === deptFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.supplier_name.toLowerCase().includes(q) ||
          r.display_id.toLowerCase().includes(q) ||
          r.requester_email.toLowerCase().includes(q),
      );
    }
    if (dateFrom) {
      list = list.filter((r) => {
        const d = dateField === "created"
          ? r.created_at.slice(0, 10)
          : r.expected_payment_date ?? "";
        return d >= dateFrom;
      });
    }
    if (dateTo) {
      list = list.filter((r) => {
        const d = dateField === "created"
          ? r.created_at.slice(0, 10)
          : r.expected_payment_date ?? "";
        return !!d && d <= dateTo;
      });
    }
    return list;
  }, [requests, statusFilter, typeFilter, deptFilter, search, dateFrom, dateTo, dateField]);

  const toValidate = useMemo(
    () => (requests ?? []).filter((r) => r.status === "awaiting_finance"),
    [requests],
  );

  const toPay = useMemo(
    () => (requests ?? []).filter((r) => r.status === "awaiting_payment"),
    [requests],
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  const markPaid = async (r: PurchaseRequest) => {
    const ref = window.prompt(
      `Marcar ${r.display_id} (${formatBRL(Number(r.total_amount))}) como paga.\nReferência do pagamento (opcional):`,
    );
    if (ref === null) return;
    setBusyId(r.id);
    const { error } = await supabaseBrowser(supabaseToken).rpc("mark_purchase_request_paid", {
      p_request_id: r.id,
      p_payment_reference: ref.trim() || null,
    });
    setBusyId(null);
    if (error) {
      flash(`Erro: ${error.message}`);
      return;
    }
    flash(`${r.display_id} marcada como paga.`);
    void load();
  };

  const exportXLSX = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/export");
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        flash(b.error ?? "Erro ao gerar o export.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gobuy-pagamentos.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const exportCSV = () => {
    const header =
      "ID,Fornecedor,Departamento,Centro de custo,Tipo,Status,Valor,Solicitante,Criada em,Paga em,Referência";
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filtered.map((r) =>
      [
        r.display_id,
        r.supplier_name,
        r.cost_centers?.department,
        r.cost_centers ? `${r.cost_centers.code} — ${r.cost_centers.name}` : "",
        TYPE_LABEL[r.request_type],
        STATUS_LABEL[r.status],
        Number(r.total_amount).toFixed(2),
        r.requester_email,
        formatDate(r.created_at),
        r.paid_at ? formatDate(r.paid_at) : "",
        r.payment_reference ?? "",
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gobuy-solicitacoes.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="reveal reveal-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financeiro</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Todas as solicitações, documentos fiscais e execução de pagamentos.
          </p>
        </div>
        <div className="flex gap-2">
          {canMarkPaid && (
            <button
              onClick={() => void exportXLSX()}
              disabled={exporting}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              {exporting ? "Gerando…" : "Exportar pagamentos (XLSX)"}
            </button>
          )}
          <button
            onClick={exportCSV}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {toast && (
        <p className="reveal mt-5 rounded-lg border border-[var(--approved)] bg-[var(--approved-soft)] px-4 py-2.5 text-sm text-[var(--approved)]">
          {toast}
        </p>
      )}

      {/* Validation queue */}
      {canMarkPaid && toValidate.length > 0 && (
        <div className="reveal reveal-2 mt-7 overflow-hidden rounded-xl border border-[var(--awaiting-finance)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="border-b border-[var(--line)] bg-[var(--awaiting-finance-soft)] px-5 py-3">
            <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--awaiting-finance)]">
              Aguardando validação · {toValidate.length} ·{" "}
              {formatBRL(toValidate.reduce((a, r) => a + Number(r.total_amount), 0))}
            </h2>
          </div>
          <ul>
            {toValidate.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-4 border-b border-[var(--line)] px-5 py-3 last:border-b-0"
              >
                <button
                  onClick={() => setOpenRequest(r)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left"
                >
                  <span className="v-tabular text-xs font-semibold text-[var(--accent)]">
                    {r.display_id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {r.supplier_name}
                  </span>
                  <span className="hidden text-xs text-[var(--muted)] sm:block">
                    {r.expected_payment_date ? `Previsão ${formatDateOnlyBR(r.expected_payment_date)}` : ""}
                  </span>
                  <span className="v-tabular text-sm font-bold">
                    {formatBRL(Number(r.total_amount))}
                  </span>
                </button>
                <button
                  onClick={() => setOpenRequest(r)}
                  className="rounded-lg bg-[var(--awaiting-finance)] px-3 py-1.5 text-xs font-bold text-[var(--on-status)] transition hover:opacity-90"
                >
                  Validar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Payment queue */}
      {canMarkPaid && toPay.length > 0 && (
        <div className="reveal reveal-2 mt-7 overflow-hidden rounded-xl border border-[var(--paid)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="border-b border-[var(--line)] bg-[var(--paid-soft)] px-5 py-3">
            <h2 className="v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--paid)]">
              Fila de pagamento · {toPay.length} ·{" "}
              {formatBRL(toPay.reduce((a, r) => a + Number(r.total_amount), 0))}
            </h2>
          </div>
          <ul>
            {toPay.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-4 border-b border-[var(--line)] px-5 py-3 last:border-b-0"
              >
                <button
                  onClick={() => setOpenRequest(r)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left"
                >
                  <span className="v-tabular text-xs font-semibold text-[var(--accent)]">
                    {r.display_id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {r.supplier_name}
                  </span>
                  <span className="hidden text-xs text-[var(--muted)] sm:block">
                    {r.cost_centers?.department}
                  </span>
                  <span className="v-tabular text-sm font-bold">
                    {formatBRL(Number(r.total_amount))}
                  </span>
                </button>
                <button
                  onClick={() => markPaid(r)}
                  disabled={busyId === r.id}
                  className="rounded-lg bg-[var(--paid)] px-3 py-1.5 text-xs font-bold text-[var(--on-status)] transition hover:opacity-90 disabled:opacity-60"
                >
                  {busyId === r.id ? "…" : "Marcar paga"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* All requests */}
      <div className="reveal reveal-3 mt-7 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="space-y-2 border-b border-[var(--line)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por ID, fornecedor ou solicitante…"
              className="max-w-56 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]">
              <option value="all">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]">
              <option value="all">Todos os tipos</option>
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]">
              <option value="all">Todos os departamentos</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <span className="ml-auto v-tabular text-[11px] text-[var(--faint)]">
              {filtered.length} de {requests?.length ?? 0}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="v-tabular text-[10px] uppercase tracking-[0.15em] text-[var(--faint)]">Por</span>
            <div className="flex items-center gap-0.5 rounded-md border border-[var(--line)] p-0.5">
              {(["created", "payment"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setDateField(f)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
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
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]"
              title="De"
            />
            <span className="text-[11px] text-[var(--faint)]">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]"
              title="Até"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-[11px] font-semibold text-[var(--accent)] hover:underline"
              >
                Limpar datas
              </button>
            )}
          </div>
        </div>

        {/* Column headers (desktop only) */}
        <div className="hidden border-b border-[var(--line)] bg-[var(--surface-2)] px-5 py-2 sm:grid sm:grid-cols-[90px_1fr_170px_auto_100px_90px_90px_120px] sm:gap-x-4">
          {["Solicitação", "Solicitante", "Departamento", "Tipo", "Valor", "Dt. solicitação", "Pag. previsto", "Status"].map((h) => (
            <span key={h} className="v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">
              {h}
            </span>
          ))}
        </div>

        {requests === null ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma solicitação encontrada.
          </p>
        ) : (
          <ul>
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setOpenRequest(r)}
                  className="grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-1 border-b border-[var(--line)] px-5 py-3 text-left transition last:border-b-0 hover:bg-[var(--surface-2)] sm:grid-cols-[90px_1fr_170px_auto_100px_90px_90px_120px]"
                >
                  <span className="v-tabular text-xs font-semibold text-[var(--accent)]">
                    {r.display_id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.supplier_name}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {r.requester_email}
                    </span>
                  </span>
                  <span className="hidden sm:block">
                    <span className="block truncate text-xs font-medium">{r.cost_centers?.department}</span>
                    <span className="block truncate text-[11px] text-[var(--faint)]">
                      {r.cost_centers?.code} — {r.cost_centers?.name}
                    </span>
                    {r.cost_centers?.cost_center_heads?.slice(0, 2).map((h) => (
                      <span key={h.head_email} className="block truncate text-[10px] text-[var(--muted)]">
                        {h.head_name ?? h.head_email.split("@")[0]}
                      </span>
                    ))}
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
                  <span className="hidden text-right v-tabular text-xs text-[var(--muted)] sm:block">
                    {r.expected_payment_date ? formatDateOnlyBR(r.expected_payment_date) : "—"}
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

      {openRequest && (
        <RequestDrawer
          key={openRequest.id}
          request={openRequest}
          viewerEmail={email}
          supabaseToken={supabaseToken}
          canDecide={false}
          canFinance={canMarkPaid}
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
