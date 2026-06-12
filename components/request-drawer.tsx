"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StatusBadge, TypeBadge } from "@/components/status-badge";
import {
  DOC_TYPE_LABEL,
  EVENT_LABEL,
  formatBRL,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_TYPES,
  allowedDocTypes,
  expectedPaymentDate,
  formatAmount,
  formatDateBR,
} from "@/lib/payment";
import { supabaseBrowser } from "@/lib/supabase/client";
import type {
  DocumentType,
  PaymentMethod,
  PurchaseRequest,
  RequestAllocation,
  RequestDocument,
  RequestEvent,
  RequestItem,
} from "@/lib/types";

export function RequestDrawer({
  request,
  viewerEmail,
  supabaseToken,
  canDecide,
  canFinance = false,
  onClose,
  onChanged,
}: {
  request: PurchaseRequest;
  viewerEmail: string;
  supabaseToken: string;
  /** true when the viewer can approve/reject (head context). */
  canDecide: boolean;
  /** true when the viewer is finance/admin (can validate payment info). */
  canFinance?: boolean;
  onClose: () => void;
  onChanged: (message?: string) => void;
}) {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [documents, setDocuments] = useState<RequestDocument[]>([]);
  const [allocations, setAllocations] = useState<RequestAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Payment-info form (requester, after approval)
  const [nfNumber, setNfNumber] = useState(request.nf_number ?? "");
  const [dueDate, setDueDate] = useState(request.payment_due_date ?? "");
  const [payMethod, setPayMethod] = useState<PaymentMethod>(request.payment_method ?? "pix");
  const [pixKey, setPixKey] = useState(request.pix_key ?? "");
  const [bankName, setBankName] = useState(request.bank_name ?? "");
  const [bankAgency, setBankAgency] = useState(request.bank_agency ?? "");
  const [bankAccount, setBankAccount] = useState(request.bank_account ?? "");

  // Finance validation form
  const [financePaymentType, setFinancePaymentType] = useState(request.payment_type ?? PAYMENT_TYPES[0]);
  const [financeExpectedDate, setFinanceExpectedDate] = useState(request.expected_payment_date ?? "");

  const isOwner = request.requester_email === viewerEmail;
  const canCancel = isOwner && request.status === "pending";
  const docTypeOptions = allowedDocTypes(request.status);
  const canUpload = docTypeOptions.length > 0;
  const [docType, setDocType] = useState<DocumentType>(docTypeOptions[0] ?? "other");
  const currency = request.currency || "BRL";
  const fmt = (n: number) => (currency === "BRL" ? formatBRL(n) : formatAmount(n, currency));

  const showPaymentForm = request.status === "approved" && (isOwner || canFinance);
  const showFinanceValidation = request.status === "awaiting_finance" && canFinance;
  const previewExpected = formatDateBR(expectedPaymentDate());
  const hasDoc = (t: DocumentType) => documents.some((d) => d.doc_type === t);

  const loadDetails = useCallback(async () => {
    const supabase = supabaseBrowser(supabaseToken);
    const [itemsRes, eventsRes, docsRes, allocRes] = await Promise.all([
      supabase.from("request_items").select("*").eq("request_id", request.id).order("position"),
      supabase.from("request_events").select("*").eq("request_id", request.id).order("id"),
      supabase
        .from("request_documents")
        .select("id, request_id, doc_type, original_filename, content_type, size_bytes, uploaded_by_email, created_at")
        .eq("request_id", request.id)
        .order("created_at"),
      supabase
        .from("request_allocations")
        .select("cost_center_id, percentage, cost_centers(code, name, department)")
        .eq("request_id", request.id),
    ]);
    setItems((itemsRes.data as unknown as RequestItem[]) ?? []);
    setEvents((eventsRes.data as unknown as RequestEvent[]) ?? []);
    setDocuments((docsRes.data as unknown as RequestDocument[]) ?? []);
    setAllocations((allocRes.data as unknown as RequestAllocation[]) ?? []);
    setLoading(false);
  }, [request.id, supabaseToken]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const act = async (
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    done: string,
  ) => {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onChanged(done);
  };

  const cancel = () =>
    window.confirm(`Cancelar a solicitação ${request.display_id}?`) &&
    act(
      () => supabaseBrowser(supabaseToken).rpc("cancel_purchase_request", { p_request_id: request.id }),
      `${request.display_id} cancelada.`,
    );

  const decide = async (action: "approve" | "reject") => {
    if (action === "reject" && !rejectReason.trim()) {
      setError("Informe o motivo da recusa.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/requests/${request.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: rejectReason.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { error?: string };
      setError(b.error ?? "Erro ao processar decisão.");
      return;
    }
    onChanged(
      action === "approve"
        ? `${request.display_id} aprovada.`
        : `${request.display_id} recusada.`,
    );
  };

  const submitPaymentInfo = async () => {
    if (request.request_type !== "advance" && !nfNumber.trim()) {
      setError("Informe o número da nota fiscal.");
      return;
    }
    if (!dueDate) {
      setError("Informe a data de vencimento do pagamento.");
      return;
    }
    if (request.request_type !== "advance" && !hasDoc("nota_fiscal")) {
      setError("Anexe a nota fiscal antes de enviar ao financeiro.");
      return;
    }
    if (payMethod === "pix" && !pixKey.trim()) {
      setError("Informe a chave Pix.");
      return;
    }
    if (payMethod === "transfer" && (!bankName.trim() || !bankAgency.trim() || !bankAccount.trim())) {
      setError("Informe banco, agência e conta.");
      return;
    }
    if (payMethod === "boleto" && !hasDoc("boleto")) {
      setError("Anexe o PDF do boleto antes de enviar.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/requests/${request.id}/payment-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nf_number: nfNumber.trim() || undefined,
        payment_due_date: dueDate,
        payment_method: payMethod,
        pix_key: payMethod === "pix" ? pixKey.trim() : undefined,
        bank_name: payMethod === "transfer" ? bankName.trim() : undefined,
        bank_agency: payMethod === "transfer" ? bankAgency.trim() : undefined,
        bank_account: payMethod === "transfer" ? bankAccount.trim() : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "Erro ao enviar dados de pagamento.");
      return;
    }
    onChanged(`${request.display_id} enviada ao financeiro.`);
  };

  const financeConfirm = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabaseBrowser(supabaseToken).rpc("finance_confirm_payment_info", {
      p_request_id: request.id,
      p_payment_type: financePaymentType,
      p_expected_payment_date: financeExpectedDate || null,
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onChanged(`${request.display_id} validada — aguardando pagamento.`);
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("request_id", request.id);
      form.set("doc_type", docType);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha no upload.");
      }
      await loadDetails();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no upload.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (docId: string) => {
    setError(null);
    const res = await fetch(`/api/documents/${docId}`);
    if (!res.ok) {
      setError("Não foi possível gerar o link do documento.");
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className="drawer-enter flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)]">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="v-tabular text-lg font-bold text-[var(--accent)]">
                {request.display_id}
              </p>
              <p className="mt-0.5 text-sm font-semibold">{request.supplier_name}</p>
              <div className="mt-2 flex gap-2">
                <TypeBadge type={request.request_type} />
                <StatusBadge status={request.status} />
              </div>
            </div>
            <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--ink)]">✕</button>
          </div>
        </div>

        <div className="flex-1 space-y-6 px-6 py-5">
          {/* Meta */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Meta label="Solicitante" value={request.requester_email} accent />
            <Meta label="Departamento" value={request.cost_centers?.department ?? "—"} />
            <Meta
              label="Centro de custo"
              value={
                request.cost_centers
                  ? `${request.cost_centers.code} — ${request.cost_centers.name}`
                  : "—"
              }
              full
            />
            <Meta label="Valor" value={fmt(Number(request.total_amount))} strong />
            <Meta label="Criada em" value={formatDate(request.created_at)} />
            {currency !== "BRL" && <Meta label="Moeda" value={currency} />}
            {request.contracted_company && (
              <Meta label="Empresa contratada" value={request.contracted_company} />
            )}
            {request.company && <Meta label="Empresa" value={request.company} />}
            {request.supplier_document && (
              <Meta
                label={request.request_type === "advance" ? "CPF" : "CNPJ"}
                value={request.supplier_document}
              />
            )}
            {request.decided_by_email && (
              <Meta label="Decidida por" value={request.decided_by_email} />
            )}
            {request.decision_reason && (
              <Meta label="Motivo da recusa" value={request.decision_reason} full />
            )}
            {request.nf_number && <Meta label="Nº da nota fiscal" value={request.nf_number} />}
            {request.payment_due_date && (
              <Meta label="Vencimento" value={formatDate(request.payment_due_date)} />
            )}
            {request.expected_payment_date && (
              <Meta
                label="Previsão de pagamento"
                value={formatDate(request.expected_payment_date)}
                strong
              />
            )}
            {request.payment_method && (
              <Meta
                label="Forma de pagamento"
                value={
                  request.payment_method === "pix"
                    ? `Pix · ${request.pix_key ?? ""}`
                    : request.payment_method === "transfer"
                      ? `${request.bank_name ?? ""} · Ag. ${request.bank_agency ?? ""} · Conta ${request.bank_account ?? ""}`
                      : "Boleto"
                }
                full
              />
            )}
            {request.paid_at && (
              <Meta
                label="Pagamento"
                value={`${formatDate(request.paid_at)}${request.payment_reference ? ` · ${request.payment_reference}` : ""}`}
                full
              />
            )}
          </dl>

          {/* Rateio entre departamentos */}
          {allocations.length > 1 && (
            <section>
              <SectionTitle>Rateio entre departamentos</SectionTitle>
              <ul className="space-y-1 text-sm">
                {allocations.map((a) => (
                  <li key={a.cost_center_id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate text-[var(--muted)]">
                      {a.cost_centers
                        ? `${a.cost_centers.code} — ${a.cost_centers.department}: ${a.cost_centers.name}`
                        : a.cost_center_id}
                    </span>
                    <span className="v-tabular font-semibold">{Number(a.percentage)}%</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {request.justification && (
            <section>
              <SectionTitle>Justificativa</SectionTitle>
              <p className="text-sm leading-relaxed text-[var(--muted)]">{request.justification}</p>
            </section>
          )}

          {/* Items */}
          {items.length > 0 && (
            <section>
              <SectionTitle>Itens</SectionTitle>
              <table className="w-full text-sm">
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-[var(--line)] last:border-b-0">
                      <td className="py-1.5 pr-2">{it.description}</td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right v-tabular text-xs text-[var(--muted)]">
                        {Number(it.quantity)} {it.unit}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right v-tabular text-xs font-semibold">
                        {formatBRL(Number(it.line_total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Documents */}
          <section>
            <SectionTitle>Documentos</SectionTitle>
            {loading ? (
              <p className="text-sm text-[var(--muted)]">Carregando…</p>
            ) : documents.length === 0 ? (
              <p className="text-sm text-[var(--faint)]">
                Nenhum documento.{" "}
                {canUpload &&
                  (request.status === "pending"
                    ? "Enquanto pendente, anexe cotações e contratos."
                    : "Anexe a nota fiscal e demais documentos abaixo.")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {documents.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => download(d.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--line)] px-3 py-2 text-left text-sm transition hover:border-[var(--accent)]"
                    >
                      <span className="v-tabular rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--accent)]">
                        {DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{d.original_filename}</span>
                      <span className="v-tabular text-[10px] text-[var(--faint)]">
                        {d.size_bytes ? `${Math.max(1, Math.round(d.size_bytes / 1024))} KB` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {canUpload && (
              <div className="mt-3 flex gap-2">
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  className="input w-auto text-xs"
                >
                  {docTypeOptions.map((t) => (
                    <option key={t} value={t}>
                      {DOC_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-2 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  {busy
                    ? "Enviando…"
                    : request.status === "pending"
                      ? "Anexar PDF (cotação, contrato)"
                      : "Anexar PDF (NF, boleto…)"}
                </button>
              </div>
            )}
          </section>

          {/* Dados para pagamento (solicitante, após aprovação) */}
          {showPaymentForm && (
            <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
              <SectionTitle>Dados para pagamento</SectionTitle>
              <p className="mb-3 text-xs text-[var(--muted)]">
                Anexe a nota fiscal acima e preencha os dados abaixo para enviar ao financeiro.
                Pagamentos ocorrem às terças e sextas — previsão atual:{" "}
                <strong className="v-tabular">{previewExpected}</strong>.
              </p>
              <div className="space-y-3">
                {request.request_type !== "advance" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                      Número da nota fiscal *
                    </label>
                    <input
                      value={nfNumber}
                      onChange={(e) => setNfNumber(e.target.value)}
                      className="input text-sm"
                      maxLength={100}
                      placeholder="Ex.: 12345"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    Data de vencimento do pagamento *
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="input text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    Forma de pagamento *
                  </label>
                  <div className="flex gap-2">
                    {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPayMethod(m)}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                          payMethod === m
                            ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--accent)]"
                            : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)]"
                        }`}
                      >
                        {PAYMENT_METHOD_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
                {payMethod === "pix" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                      Chave Pix *
                    </label>
                    <input
                      value={pixKey}
                      onChange={(e) => setPixKey(e.target.value)}
                      className="input text-sm"
                      maxLength={200}
                      placeholder="CNPJ, e-mail, telefone ou chave aleatória"
                    />
                  </div>
                )}
                {payMethod === "transfer" && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-3 sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Banco *</label>
                      <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="input text-sm" maxLength={200} />
                    </div>
                    <div className="col-span-3 sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Agência *</label>
                      <input value={bankAgency} onChange={(e) => setBankAgency(e.target.value)} className="input text-sm" maxLength={200} />
                    </div>
                    <div className="col-span-3 sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Conta *</label>
                      <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className="input text-sm" maxLength={200} />
                    </div>
                  </div>
                )}
                {payMethod === "boleto" && !hasDoc("boleto") && (
                  <p className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                    Anexe o PDF do boleto na seção Documentos acima (tipo &quot;Boleto&quot;).
                  </p>
                )}
                {request.request_type !== "advance" && !hasDoc("nota_fiscal") && (
                  <p className="rounded-lg border border-[var(--rejected)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--rejected)]">
                    Nota fiscal ainda não anexada — obrigatória para enviar ao financeiro.
                  </p>
                )}
                <button
                  onClick={() => void submitPaymentInfo()}
                  disabled={busy}
                  className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Enviando…" : "Enviar ao financeiro"}
                </button>
              </div>
            </section>
          )}

          {/* Validação do financeiro */}
          {showFinanceValidation && (
            <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
              <SectionTitle>Validação do financeiro</SectionTitle>
              <p className="mb-3 text-xs text-[var(--muted)]">
                Confira os documentos e os dados de pagamento. Ao confirmar, a solicitação passa
                para &quot;Aguardando pagamento&quot; e entra no export.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    Payment Type
                  </label>
                  <select
                    value={financePaymentType}
                    onChange={(e) => setFinancePaymentType(e.target.value)}
                    className="input text-sm"
                  >
                    {PAYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    Data prevista de pagamento
                  </label>
                  <input
                    type="date"
                    value={financeExpectedDate}
                    onChange={(e) => setFinanceExpectedDate(e.target.value)}
                    className="input text-sm"
                  />
                </div>
                <button
                  onClick={() => void financeConfirm()}
                  disabled={busy}
                  className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Confirmando…" : "Confirmar — aguardando pagamento"}
                </button>
              </div>
            </section>
          )}

          {/* Timeline */}
          <section>
            <SectionTitle>Histórico</SectionTitle>
            <ol className="space-y-2.5">
              {events.map((ev) => (
                <li key={ev.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <div>
                    <p className="font-medium">{EVENT_LABEL[ev.event_type] ?? ev.event_type}</p>
                    <p className="v-tabular text-[11px] text-[var(--faint)]">
                      {formatDateTime(ev.created_at)}
                      {ev.actor_email ? ` · ${ev.actor_email}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {error && (
            <p className="rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-4 py-2.5 text-sm text-[var(--rejected)]">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        {canDecide && request.status === "pending" && (
          <div className="sticky bottom-0 space-y-3 border-t border-[var(--line)] bg-[var(--surface)] px-6 py-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
                Motivo da recusa
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Obrigatório ao recusar…"
                className="input min-h-[4rem] resize-y text-sm"
                maxLength={2000}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void decide("approve")}
                disabled={busy}
                className="flex-1 rounded-lg bg-[var(--approved)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                Aprovar
              </button>
              <button
                onClick={() => void decide("reject")}
                disabled={busy}
                className="flex-1 rounded-lg bg-[var(--rejected)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                Recusar
              </button>
            </div>
          </div>
        )}
        {canCancel && !canDecide && (
          <div className="sticky bottom-0 border-t border-[var(--line)] bg-[var(--surface)] px-6 py-4">
            <button
              onClick={cancel}
              disabled={busy}
              className="w-full rounded-lg border border-[var(--rejected)] px-4 py-2.5 text-sm font-bold text-[var(--rejected)] transition hover:bg-[var(--rejected-soft)] disabled:opacity-60"
            >
              Cancelar solicitação
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 v-tabular text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--faint)]">
      {children}
    </h3>
  );
}

function Meta({
  label,
  value,
  full,
  strong,
  accent,
}: {
  label: string;
  value: string;
  full?: boolean;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <dt className="v-tabular text-[10px] uppercase tracking-[0.18em] text-[var(--faint)]">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words ${strong ? "v-tabular text-base font-bold" : ""} ${
          accent ? "text-[var(--accent)]" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
