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
import { supabaseBrowser } from "@/lib/supabase/client";
import type {
  DocumentType,
  PurchaseRequest,
  RequestDocument,
  RequestEvent,
  RequestItem,
} from "@/lib/types";

const UPLOAD_DOC_TYPES: DocumentType[] = [
  "nota_fiscal",
  "quotation",
  "invoice",
  "receipt",
  "contract",
  "other",
];

export function RequestDrawer({
  request,
  viewerEmail,
  canDecide,
  onClose,
  onChanged,
}: {
  request: PurchaseRequest;
  viewerEmail: string;
  /** true when the viewer can approve/reject (head context). */
  canDecide: boolean;
  onClose: () => void;
  onChanged: (message?: string) => void;
}) {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [documents, setDocuments] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [docType, setDocType] = useState<DocumentType>("nota_fiscal");
  const fileRef = useRef<HTMLInputElement>(null);

  const isOwner = request.requester_email === viewerEmail;
  const canCancel = isOwner && request.status === "pending";
  const canUpload = request.status !== "cancelled" && request.status !== "rejected";

  const loadDetails = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [itemsRes, eventsRes, docsRes] = await Promise.all([
      supabase.from("request_items").select("*").eq("request_id", request.id).order("position"),
      supabase.from("request_events").select("*").eq("request_id", request.id).order("id"),
      supabase
        .from("request_documents")
        .select("id, request_id, doc_type, original_filename, content_type, size_bytes, uploaded_by_email, created_at")
        .eq("request_id", request.id)
        .order("created_at"),
    ]);
    setItems((itemsRes.data as unknown as RequestItem[]) ?? []);
    setEvents((eventsRes.data as unknown as RequestEvent[]) ?? []);
    setDocuments((docsRes.data as unknown as RequestDocument[]) ?? []);
    setLoading(false);
  }, [request.id]);

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
      () => supabaseBrowser().rpc("cancel_purchase_request", { p_request_id: request.id }),
      `${request.display_id} cancelada.`,
    );

  const approve = () =>
    act(
      () => supabaseBrowser().rpc("approve_purchase_request", { p_request_id: request.id }),
      `${request.display_id} aprovada.`,
    );

  const reject = () => {
    if (!rejectReason.trim()) {
      setError("Informe o motivo da recusa.");
      return;
    }
    return act(
      () =>
        supabaseBrowser().rpc("reject_purchase_request", {
          p_request_id: request.id,
          p_reason: rejectReason.trim(),
        }),
      `${request.display_id} recusada.`,
    );
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
            <Meta label="Valor" value={formatBRL(Number(request.total_amount))} strong />
            <Meta label="Criada em" value={formatDate(request.created_at)} />
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
            {request.paid_at && (
              <Meta
                label="Pagamento"
                value={`${formatDate(request.paid_at)}${request.payment_reference ? ` · ${request.payment_reference}` : ""}`}
                full
              />
            )}
          </dl>

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
                Nenhum documento. {canUpload && "Anexe a nota fiscal ou cotações abaixo."}
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
                  {UPLOAD_DOC_TYPES.map((t) => (
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
                  {busy ? "Enviando…" : "Anexar PDF (NF, cotação…)"}
                </button>
              </div>
            )}
          </section>

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

          {rejecting && (
            <div className="space-y-2">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Motivo da recusa (obrigatório)"
                className="input min-h-16 resize-y"
                maxLength={2000}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        {(canCancel || (canDecide && request.status === "pending")) && (
          <div className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-6 py-4">
            {canDecide && request.status === "pending" && !rejecting && (
              <>
                <button
                  onClick={approve}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-[var(--approved)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-[var(--rejected)] px-4 py-2.5 text-sm font-bold text-[var(--rejected)] transition hover:bg-[var(--rejected-soft)] disabled:opacity-60"
                >
                  Recusar
                </button>
              </>
            )}
            {canDecide && request.status === "pending" && rejecting && (
              <>
                <button
                  onClick={reject}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-[var(--rejected)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  Confirmar recusa
                </button>
                <button
                  onClick={() => setRejecting(false)}
                  disabled={busy}
                  className="rounded-lg border border-[var(--line-strong)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface-2)]"
                >
                  Voltar
                </button>
              </>
            )}
            {canCancel && !canDecide && (
              <button
                onClick={cancel}
                disabled={busy}
                className="flex-1 rounded-lg border border-[var(--rejected)] px-4 py-2.5 text-sm font-bold text-[var(--rejected)] transition hover:bg-[var(--rejected-soft)] disabled:opacity-60"
              >
                Cancelar solicitação
              </button>
            )}
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
