"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { brtYmd, formatBRL, formatDate, formatDateOnlyBR, STATUS_LABEL, TYPE_LABEL } from "@/lib/format";
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

  // Parse dd/mm/yyyy → yyyy-mm-dd. Returns "" for incomplete or invalid input.
  const parseDDMMYYYY = (s: string): string => {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return "";
    const [, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}`);
    if (isNaN(d.getTime())) return "";
    return `${yyyy}-${mm}-${dd}`;
  };

  const filtered = useMemo(() => {
    const fromYMD = parseDDMMYYYY(dateFrom);
    const toYMD = parseDDMMYYYY(dateTo);
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
      a.download = "lumen-pagamentos.xlsx";
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
    a.download = "lumen-solicitacoes.csv";
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
              type="text"
              inputMode="numeric"
              maxLength={10}
              placeholder="dd/mm/yyyy"
              value={dateFrom}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                let v = digits;
                if (digits.length > 4) v = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
                else if (digits.length > 2) v = `${digits.slice(0, 2)}/${digits.slice(2)}`;
                setDateFrom(v);
              }}
              className="w-24 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]"
              aria-label="De (dd/mm/yyyy)"
            />
            <span className="text-[11px] text-[var(--faint)]">—</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              placeholder="dd/mm/yyyy"
              value={dateTo}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                let v = digits;
                if (digits.length > 4) v = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
                else if (digits.length > 2) v = `${digits.slice(0, 2)}/${digits.slice(2)}`;
                setDateTo(v);
              }}
              className="w-24 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none transition focus:border-[var(--accent)]"
              aria-label="Até (dd/mm/yyyy)"
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

        {requests === null ? (
          <div role="status" aria-label="Carregando solicitações">
            <FinanceSkeletonRow />
            <FinanceSkeletonRow />
            <FinanceSkeletonRow />
            <FinanceSkeletonRow />
            <FinanceSkeletonRow />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma solicitação encontrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" aria-label="Todas as solicitações">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]">
                  <th scope="col" className="w-[90px] px-5 py-2 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Solicitação</th>
                  <th scope="col" className="px-2 py-2 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Solicitante</th>
                  <th scope="col" className="w-[170px] px-2 py-2 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Departamento</th>
                  <th scope="col" className="px-2 py-2 text-left v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Tipo</th>
                  <th scope="col" className="w-[100px] px-2 py-2 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Valor</th>
                  <th scope="col" className="w-[90px] px-2 py-2 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Dt. solicitação</th>
                  <th scope="col" className="w-[90px] px-2 py-2 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Pag. previsto</th>
                  <th scope="col" className="w-[120px] px-5 py-2 text-right v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--faint)]">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
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
                    <td className="px-5 py-3 v-tabular text-xs font-semibold text-[var(--accent)]">
                      {r.display_id}
                    </td>
                    <td className="px-2 py-3">
                      <div className="truncate text-sm font-medium">{r.supplier_name}</div>
                      <div className="truncate text-xs text-[var(--muted)]">{r.requester_email}</div>
                    </td>
                    <td className="hidden px-2 py-3 sm:table-cell">
                      <div className="truncate text-xs font-medium">{r.cost_centers?.department}</div>
                      <div className="truncate text-[11px] text-[var(--faint)]">
                        {r.cost_centers?.code} — {r.cost_centers?.name}
                      </div>
                      {r.cost_centers?.cost_center_heads?.slice(0, 2).map((h) => (
                        <div key={h.head_email} className="truncate text-[10px] text-[var(--muted)]">
                          {h.head_name ?? h.head_email.split("@")[0]}
                        </div>
                      ))}
                    </td>
                    <td className="hidden px-2 py-3 sm:table-cell">
                      <TypeBadge type={r.request_type} />
                    </td>
                    <td className="hidden px-2 py-3 text-right v-tabular text-sm font-semibold sm:table-cell">
                      {formatBRL(Number(r.total_amount))}
                    </td>
                    <td className="hidden px-2 py-3 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="hidden px-2 py-3 text-right v-tabular text-xs text-[var(--muted)] sm:table-cell">
                      {r.expected_payment_date ? formatDateOnlyBR(r.expected_payment_date) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function FinanceSkeletonRow() {
  return (
    <div className="border-b border-[var(--line)] px-5 py-3 last:border-b-0">
      <div className="flex items-center gap-4">
        <div className="h-3.5 w-14 shrink-0 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="h-3.5 flex-1 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="hidden h-5 w-24 shrink-0 animate-pulse rounded-full bg-[var(--surface-2)] sm:block" />
      </div>
    </div>
  );
}
