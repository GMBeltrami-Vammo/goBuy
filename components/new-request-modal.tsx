"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { NewFornecedorModal } from "@/components/new-fornecedor-modal";
import { DOC_TYPE_LABEL, formatBRL } from "@/lib/format";
import { COMPANIES, CURRENCIES, CURRENCY_CUSTOM, allowedDocTypes, formatAmount } from "@/lib/payment";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { CostCenter, DocumentType, Fornecedor, RequestType } from "@/lib/types";

interface StagedDoc {
  file: File;
  docType: DocumentType;
}

// Documents that may be attached while the request is still pending.
const CREATE_DOC_TYPES = allowedDocTypes("pending");

interface ItemDraft {
  description: string;
  quantity: string;
  unit: string;
  unit_value: string;
}

interface AllocationDraft {
  ccId: string;
  percentage: string;
}

const EMPTY_ITEM: ItemDraft = { description: "", quantity: "1", unit: "un", unit_value: "" };

const UNITS = ["un", "cx", "kg", "par", "m", "L", "h"];

export function NewRequestModal({
  costCenters,
  fornecedores,
  supabaseToken,
  onClose,
  onSubmitted,
  onFornecedorCreated,
}: {
  costCenters: CostCenter[];
  /** Approved + active fornecedores selectable on the request. */
  fornecedores: Fornecedor[];
  supabaseToken: string;
  onClose: () => void;
  onSubmitted: (displayId: string, note?: string) => void;
  /** Called after an inline fornecedor registration so the parent can refresh. */
  onFornecedorCreated?: () => void;
}) {
  useBodyScrollLock();

  // Dismiss on Esc. Routed through dismissRef so that, once the request has been
  // created (retry state), closing still notifies the parent to refresh.
  const dismissRef = useRef<() => void>(() => onClose());
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") dismissRef.current(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const [type, setType] = useState<RequestType>("products");
  const [fornId, setFornId] = useState<string>("");
  const [showNewForn, setShowNewForn] = useState(false);
  const [newFornNote, setNewFornNote] = useState<string | null>(null);
  const [ccId, setCcId] = useState<string>("");
  const [justification, setJustification] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);
  const [serviceValue, setServiceValue] = useState("");
  const [servicePeriod, setServicePeriod] = useState("Pontual / avulso");
  const [serviceStart, setServiceStart] = useState("");
  const [serviceEnd, setServiceEnd] = useState("");
  const [advanceValue, setAdvanceValue] = useState("");
  const [advancePurpose, setAdvancePurpose] = useState("Viagem / deslocamento");
  const [advanceUseDate, setAdvanceUseDate] = useState("");
  const [advanceDeadline, setAdvanceDeadline] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [customCurrency, setCustomCurrency] = useState("");
  const [company, setCompany] = useState<string>(COMPANIES[0]);
  const [splitDepts, setSplitDepts] = useState(false);
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stagedDocs, setStagedDocs] = useState<StagedDoc[]>([]);
  const [docType, setDocType] = useState<DocumentType>(CREATE_DOC_TYPES[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Synchronous guard against a rapid double-click submitting the request twice
  // (the `sending` state disables the button, but only after a re-render).
  const submittingRef = useRef(false);
  // After the request is created, uploads that fail are kept here so the user
  // can retry them against the already-created request (never a duplicate).
  const [created, setCreated] = useState<{ id: string; display_id: string } | null>(null);
  const [failedDocs, setFailedDocs] = useState<StagedDoc[]>([]);
  const [retrying, setRetrying] = useState(false);

  const activeCurrency =
    currency === CURRENCY_CUSTOM ? customCurrency.trim().toUpperCase() : currency;
  const fmt = (n: number) => {
    if (!activeCurrency || activeCurrency === "BRL") return formatBRL(n);
    try {
      return formatAmount(n, activeCurrency);
    } catch {
      return formatBRL(n);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CostCenter[]>();
    for (const cc of costCenters) {
      const list = map.get(cc.department) ?? [];
      list.push(cc);
      map.set(cc.department, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [costCenters]);

  const selectedCc = useMemo(
    () => costCenters.find((c) => String(c.id) === ccId) ?? null,
    [costCenters, ccId],
  );

  const selectedForn = useMemo(
    () => fornecedores.find((f) => String(f.id) === fornId) ?? null,
    [fornecedores, fornId],
  );

  // On picking a fornecedor, pre-select the cost center: the supplier's manual
  // default if set (and still active), otherwise its most-used CC (server-side).
  const onSelectForn = async (id: string) => {
    setFornId(id);
    if (fieldErrors.fornecedor) setFieldErrors((p) => ({ ...p, fornecedor: "" }));
    if (!id) return;
    const f = fornecedores.find((x) => String(x.id) === id);
    if (!f) return;
    const isActiveCc = (cc: number | null | undefined) =>
      cc != null && costCenters.some((c) => c.id === cc);
    if (isActiveCc(f.default_cost_center_id)) {
      setCcId(String(f.default_cost_center_id));
      if (fieldErrors.cc) setFieldErrors((p) => ({ ...p, cc: "" }));
      return;
    }
    const { data: topCc } = await supabaseBrowser(supabaseToken).rpc("fornecedor_top_cc", {
      p_id: f.id,
    });
    if (isActiveCc(topCc as number | null)) {
      setCcId(String(topCc));
      if (fieldErrors.cc) setFieldErrors((p) => ({ ...p, cc: "" }));
    }
  };

  const itemsTotal = useMemo(
    () =>
      items.reduce((acc, it) => {
        const q = parseFloat(it.quantity) || 0;
        const v = parseFloat(it.unit_value) || 0;
        return acc + Math.round(q * v * 100) / 100;
      }, 0),
    [items],
  );

  const total =
    type === "products"
      ? itemsTotal
      : parseFloat(type === "service" ? serviceValue : advanceValue) || 0;

  const isAdvance = type === "advance";

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  // The last allocation row always fills the remainder so the split sums to
  // exactly 100% — the user only types the earlier rows.
  const othersSum = useMemo(
    () => allocations.slice(0, -1).reduce((s, a) => s + (parseFloat(a.percentage) || 0), 0),
    [allocations],
  );
  const lastPct = Math.round((100 - othersSum) * 100) / 100;

  // Upload a set of staged docs to an existing request; returns the ones that
  // failed so the caller can offer a retry.
  const uploadDocs = async (reqId: string, docs: StagedDoc[]): Promise<StagedDoc[]> => {
    const failed: StagedDoc[] = [];
    for (const doc of docs) {
      try {
        const form = new FormData();
        form.set("file", doc.file);
        form.set("request_id", reqId);
        form.set("doc_type", doc.docType);
        const up = await fetch("/api/documents", { method: "POST", body: form });
        if (!up.ok) failed.push(doc);
      } catch {
        failed.push(doc);
      }
    }
    return failed;
  };

  const submit = async () => {
    if (submittingRef.current) return;
    const errs: Record<string, string> = {};

    if (!fornId)
      errs.fornecedor = isAdvance ? "Selecione o beneficiário." : "Selecione o fornecedor.";
    if (!ccId)
      errs.cc = "Selecione o centro de custo.";
    if (currency === CURRENCY_CUSTOM && !/^[A-Z]{2,10}$/.test(customCurrency.trim().toUpperCase()))
      errs.customCurrency = "Código inválido (ex: CLP, CHF).";
    if (type === "products" && items.every((i) => !i.description.trim()))
      errs.items = "Adicione ao menos um item com descrição.";
    if (total <= 0) {
      if (type === "service") errs.serviceValue = "Informe um valor maior que zero.";
      else if (type === "advance") errs.advanceValue = "Informe um valor maior que zero.";
      else errs.items = errs.items ?? "O total deve ser maior que zero.";
    }
    if (splitDepts) {
      if (allocations.length < 2)
        errs.rateio = "Rateio exige ao menos dois departamentos.";
      else if (allocations.some((a) => !a.ccId))
        errs.rateio = "Selecione o centro de custo em cada linha do rateio.";
      else if (allocations.slice(0, -1).some((a) => (parseFloat(a.percentage) || 0) <= 0))
        errs.rateio = "Cada departamento precisa de um percentual maior que zero.";
      else if (lastPct <= 0)
        errs.rateio = `Os demais departamentos já somam ${othersSum.toFixed(2).replace(".", ",")}%. Reduza para liberar o último.`;
    }

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setServerError(null);

    const payload: Record<string, unknown> = {
      request_type: type,
      fornecedor_id: Number(fornId),
      // Sent for the Slack notification fallback; the RPC re-derives the
      // authoritative name/document from the fornecedor record.
      supplier_name: selectedForn?.razao_social ?? "",
      supplier_document: selectedForn?.document ?? null,
      cost_center_id: Number(ccId),
      justification: justification.trim() || null,
      notes: notes.trim() || null,
      currency: activeCurrency || "BRL",
      company: company || COMPANIES[0],
    };
    if (splitDepts) {
      const last = allocations.length - 1;
      payload.allocations = allocations.map((a, i) => ({
        cost_center_id: Number(a.ccId),
        percentage: i === last ? lastPct : parseFloat(a.percentage),
      }));
    }

    if (type === "products") {
      payload.items = items
        .filter((i) => i.description.trim())
        .map((i) => ({
          description: i.description.trim(),
          quantity: parseFloat(i.quantity) || 0,
          unit: i.unit,
          unit_value: parseFloat(i.unit_value) || 0,
        }));
    } else if (type === "service") {
      payload.total_amount = total;
      payload.service_period = servicePeriod;
      if (serviceStart) payload.service_start = serviceStart;
      if (serviceEnd) payload.service_end = serviceEnd;
    } else {
      payload.total_amount = total;
      payload.advance_purpose = advancePurpose;
      if (advanceUseDate) payload.advance_use_date = advanceUseDate;
      if (advanceDeadline) payload.advance_settlement_deadline = advanceDeadline;
    }

    submittingRef.current = true;
    setSending(true);
    let res: Response;
    try {
      res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      submittingRef.current = false;
      setSending(false);
      setServerError("Erro de rede. Verifique sua conexão e tente novamente.");
      return;
    }

    if (!res.ok) {
      submittingRef.current = false;
      setSending(false);
      const body = await res.json().catch(() => ({})) as { error?: string };
      setServerError(body.error ?? "Erro ao enviar solicitação.");
      return;
    }

    const data = await res.json() as { id: string; display_id: string };

    // Upload staged documents now that the request exists. The request itself
    // already succeeded, so failures never roll it back — instead we surface
    // the failed files and let the user retry them (see the retry panel).
    const failed = await uploadDocs(data.id, stagedDocs);
    setSending(false);

    if (failed.length === 0) {
      onSubmitted(data.display_id);
      return;
    }
    // Keep the modal open in retry mode.
    setCreated(data);
    setFailedDocs(failed);
  };

  // Retry only the documents that failed, against the already-created request.
  const retryFailedDocs = async () => {
    if (!created) return;
    setRetrying(true);
    const stillFailed = await uploadDocs(created.id, failedDocs);
    setRetrying(false);
    setFailedDocs(stillFailed);
    if (stillFailed.length === 0) onSubmitted(created.display_id);
  };

  const addStagedFiles = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files).map((file) => ({ file, docType }));
    setStagedDocs((prev) => [...prev, ...incoming]);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Keep the dismiss behaviour current: before creation, just close; after
  // creation, notify the parent (with a note about any still-unattached docs)
  // so the new request shows up in the list.
  dismissRef.current = () => {
    if (created) {
      onSubmitted(
        created.display_id,
        failedDocs.length > 0
          ? `Atenção: ${failedDocs.length} documento(s) não foram anexados — reenvie pela solicitação.`
          : undefined,
      );
    } else {
      onClose();
    }
  };

  // Retry state: the request exists, but some documents still need attaching.
  if (created && failedDocs.length > 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] sm:p-8"
        onMouseDown={(e) => e.target === e.currentTarget && dismissRef.current()}
      >
        <div className="modal-enter w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
            <h2 className="text-lg font-bold">Solicitação {created.display_id} criada</h2>
            <button
              onClick={() => dismissRef.current()}
              aria-label="Fechar"
              className="text-[var(--faint)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              ✕
            </button>
          </div>
          <div className="space-y-4 px-6 py-5">
            <p
              role="alert"
              className="rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-4 py-2.5 text-sm text-[var(--rejected)]"
            >
              A solicitação foi criada, mas {failedDocs.length} documento(s) não foram anexados.
              Tente reenviar abaixo — ou conclua e anexe depois pela própria solicitação.
            </p>
            <ul className="space-y-1.5">
              {failedDocs.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <span className="v-tabular rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--accent)]">
                    {DOC_TYPE_LABEL[d.docType]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{d.file.name}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
            <button
              onClick={() => dismissRef.current()}
              className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Concluir mesmo assim
            </button>
            <button
              onClick={() => void retryFailedDocs()}
              disabled={retrying}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            >
              {retrying ? "Reenviando…" : "Tentar novamente"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && dismissRef.current()}
    >
      <div className="modal-enter w-full max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <h2 className="text-lg font-bold">Nova solicitação</h2>
          <button
            onClick={() => dismissRef.current()}
            aria-label="Fechar"
            className="text-[var(--faint)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Type */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de solicitação">
            {(
              [
                ["products", "Produtos / materiais"],
                ["service", "Contratação de serviço"],
                ["advance", "Adiantamento"],
              ] as [RequestType, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={`rounded-lg border px-4 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  type === t
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Supplier + CC */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isAdvance ? "Beneficiário (fornecedor)" : "Fornecedor"} error={fieldErrors.fornecedor}>
              <select
                value={fornId}
                onChange={(e) => void onSelectForn(e.target.value)}
                className="input"
              >
                <option value="">Selecione…</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.razao_social} — {f.document}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewForn(true)}
                className="mt-1.5 text-xs font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                + Adicionar novo fornecedor
              </button>
              {newFornNote && (
                <span className="mt-1 block text-xs text-[var(--pending-text-strong)]">{newFornNote}</span>
              )}
            </Field>
            <Field label={isAdvance ? "CPF" : "CNPJ"}>
              <input
                readOnly
                value={selectedForn?.document ?? ""}
                placeholder="Preenchido pelo fornecedor"
                className="input bg-[var(--surface-2)] text-[var(--muted)]"
              />
            </Field>
            <Field label="Centro de custo" error={fieldErrors.cc}>
              <select
                value={ccId}
                onChange={(e) => { setCcId(e.target.value); if (fieldErrors.cc) setFieldErrors((p) => ({ ...p, cc: "" })); }}
                className="input"
              >
                <option value="">Selecione…</option>
                {grouped.map(([dept, ccs]) => (
                  <optgroup key={dept} label={dept}>
                    {ccs.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.code} — {cc.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Departamento / Head">
              <input
                readOnly
                value={
                  selectedCc
                    ? (() => {
                        const heads = (selectedCc.cost_center_heads ?? [])
                          .map((h) => h.head_name ?? h.head_email.split("@")[0])
                          .join(", ");
                        return heads
                          ? `${selectedCc.department} · ${heads}`
                          : selectedCc.department;
                      })()
                    : ""
                }
                placeholder="Preenchido pelo centro de custo"
                className="input bg-[var(--surface-2)] text-[var(--muted)]"
              />
            </Field>
            <Field label="Moeda" error={fieldErrors.customCurrency}>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="input"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
                <option value={CURRENCY_CUSTOM}>Outra moeda (digitar código)…</option>
              </select>
              {currency === CURRENCY_CUSTOM && (
                <input
                  value={customCurrency}
                  onChange={(e) => setCustomCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10))}
                  placeholder="Ex: CLP, PEN, CHF"
                  className="input mt-2"
                  maxLength={10}
                  autoFocus
                />
              )}
            </Field>
            <Field label="Empresa responsável">
              <select value={company} onChange={(e) => setCompany(e.target.value)} className="input">
                {COMPANIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Justificativa" full>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Descreva a necessidade e o impacto operacional…"
                className="input min-h-20 resize-y"
                maxLength={4000}
              />
            </Field>
          </div>

          {/* Rateio entre departamentos */}
          <div className="rounded-lg border border-[var(--line)] px-4 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={splitDepts}
                onChange={(e) => {
                  setSplitDepts(e.target.checked);
                  if (e.target.checked && allocations.length === 0) {
                    setAllocations([
                      { ccId, percentage: "50" },
                      { ccId: "", percentage: "" },
                    ]);
                  }
                }}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="font-medium">Rateio entre múltiplos departamentos</span>
            </label>
            {splitDepts && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-[var(--faint)]">
                  O último departamento recebe automaticamente o percentual restante para fechar 100%.
                </p>
                {allocations.map((a, i) => {
                  const isLast = i === allocations.length - 1;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={a.ccId}
                        onChange={(e) =>
                          setAllocations((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, ccId: e.target.value } : x)),
                          )
                        }
                        aria-label={`Centro de custo do rateio ${i + 1}`}
                        className="input min-w-0 flex-1 text-sm"
                      >
                        <option value="">Centro de custo…</option>
                        {grouped.map(([dept, ccs]) => (
                          <optgroup key={dept} label={dept}>
                            {ccs.map((cc) => (
                              <option key={cc.id} value={cc.id}>
                                {cc.code} — {cc.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={isLast ? (lastPct >= 0 ? String(lastPct) : "0") : a.percentage}
                        readOnly={isLast}
                        title={isLast ? "Calculado automaticamente (restante para 100%)" : undefined}
                        onChange={(e) =>
                          setAllocations((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, percentage: e.target.value } : x)),
                          )
                        }
                        aria-label={`Percentual do rateio ${i + 1}`}
                        className={`w-28 shrink-0 rounded-lg border px-2 py-2 text-right text-sm outline-none transition focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] ${
                          isLast
                            ? "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)]"
                            : "border-[var(--line-strong)] bg-[var(--bg)] text-[var(--ink)]"
                        }`}
                      />
                      <span className="shrink-0 text-sm text-[var(--muted)]">%</span>
                      <button
                        type="button"
                        onClick={() => setAllocations((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={allocations.length <= 2}
                        className="shrink-0 text-[var(--faint)] hover:text-[var(--rejected)] disabled:opacity-30"
                        aria-label="Remover linha de rateio"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setAllocations((prev) => {
                        const others = prev
                          .slice(0, -1)
                          .reduce((s, x) => s + (parseFloat(x.percentage) || 0), 0);
                        const remainder = Math.max(0, Math.round((100 - others) * 100) / 100);
                        const frozen = prev.map((x, idx) =>
                          idx === prev.length - 1 ? { ...x, percentage: String(remainder) } : x,
                        );
                        return [...frozen, { ccId: "", percentage: "" }];
                      })
                    }
                    className="text-sm font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    + Adicionar departamento
                  </button>
                  <p
                    className={`v-tabular text-sm font-semibold ${
                      lastPct <= 0 ? "text-[var(--rejected)]" : "text-[var(--approved)]"
                    }`}
                  >
                    {lastPct <= 0
                      ? `⚠ Excede 100% (${othersSum.toFixed(2).replace(".", ",")}%)`
                      : `✓ Soma 100% · último ${lastPct.toFixed(2).replace(".", ",")}%`}
                  </p>
                </div>
                {fieldErrors.rateio && (
                  <p className="text-xs text-[var(--rejected)]" role="alert">{fieldErrors.rateio}</p>
                )}
              </div>
            )}
          </div>

          {/* Products */}
          {type === "products" && (
            <div className="rounded-lg border border-[var(--line)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left v-tabular text-[10px] uppercase tracking-[0.15em] text-[var(--faint)]">
                    <th className="px-3 py-2 font-medium">Descrição</th>
                    <th className="w-16 px-2 py-2 font-medium">Qtd</th>
                    <th className="w-16 px-2 py-2 font-medium">Un.</th>
                    <th className="w-28 px-2 py-2 font-medium">Valor unit.</th>
                    <th className="w-24 px-2 py-2 text-right font-medium">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const line =
                      Math.round((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_value) || 0) * 100) / 100;
                    return (
                      <tr key={i} className="border-b border-[var(--line)] last:border-b-0">
                        <td className="px-2 py-1">
                          <input
                            value={it.description}
                            onChange={(e) => { setItem(i, { description: e.target.value }); if (fieldErrors.items) setFieldErrors((p) => ({ ...p, items: "" })); }}
                            placeholder="Item"
                            className="input-ghost"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            value={it.quantity}
                            onChange={(e) => setItem(i, { quantity: e.target.value })}
                            className="input-ghost text-right"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={it.unit}
                            onChange={(e) => setItem(i, { unit: e.target.value })}
                            className="input-ghost"
                          >
                            {UNITS.map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={it.unit_value}
                            onChange={(e) => { setItem(i, { unit_value: e.target.value }); if (fieldErrors.items) setFieldErrors((p) => ({ ...p, items: "" })); }}
                            placeholder="0,00"
                            className="input-ghost text-right"
                          />
                        </td>
                        <td className="px-2 py-1 text-right v-tabular text-xs font-semibold">
                          {fmt(line)}
                        </td>
                        <td className="pr-2 text-center">
                          <button
                            onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                            disabled={items.length === 1}
                            className="text-[var(--faint)] hover:text-[var(--rejected)] disabled:opacity-30"
                            aria-label="Remover item"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
                    className="text-sm font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    + Adicionar item
                  </button>
                  {fieldErrors.items && (
                    <span className="text-xs text-[var(--rejected)]" role="alert">{fieldErrors.items}</span>
                  )}
                </div>
                <p className="v-tabular text-sm">
                  <span className="text-[var(--muted)]">Total </span>
                  <span className="font-bold">{fmt(itemsTotal)}</span>
                </p>
              </div>
            </div>
          )}

          {/* Service */}
          {type === "service" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Valor do contrato (${currency})`} error={fieldErrors.serviceValue}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={serviceValue}
                  onChange={(e) => { setServiceValue(e.target.value); if (fieldErrors.serviceValue) setFieldErrors((p) => ({ ...p, serviceValue: "" })); }}
                  placeholder="0,00"
                  className="input"
                />
              </Field>
              <Field label="Período">
                <select
                  value={servicePeriod}
                  onChange={(e) => setServicePeriod(e.target.value)}
                  className="input"
                >
                  <option>Pontual / avulso</option>
                  <option>Mensal — recorrente</option>
                  <option>Trimestral</option>
                  <option>Anual</option>
                </select>
              </Field>
              <Field label="Início previsto">
                <input type="date" value={serviceStart} onChange={(e) => setServiceStart(e.target.value)} className="input" />
              </Field>
              <Field label="Término">
                <input type="date" value={serviceEnd} onChange={(e) => setServiceEnd(e.target.value)} className="input" />
              </Field>
            </div>
          )}

          {/* Advance */}
          {type === "advance" && (
            <div className="space-y-4">
              <p className="rounded-lg border border-[var(--pending)] bg-[var(--pending-soft)] px-4 py-2.5 text-xs text-[var(--pending-text-strong)]">
                Adiantamentos exigem prestação de contas até o prazo informado abaixo.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Valor (${currency})`} error={fieldErrors.advanceValue}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={advanceValue}
                    onChange={(e) => { setAdvanceValue(e.target.value); if (fieldErrors.advanceValue) setFieldErrors((p) => ({ ...p, advanceValue: "" })); }}
                    placeholder="0,00"
                    className="input"
                  />
                </Field>
                <Field label="Finalidade">
                  <select
                    value={advancePurpose}
                    onChange={(e) => setAdvancePurpose(e.target.value)}
                    className="input"
                  >
                    <option>Viagem / deslocamento</option>
                    <option>Compra emergencial</option>
                    <option>Evento / representação</option>
                    <option>Despesas operacionais</option>
                    <option>Outro</option>
                  </select>
                </Field>
                <Field label="Data prevista de uso">
                  <input type="date" value={advanceUseDate} onChange={(e) => setAdvanceUseDate(e.target.value)} className="input" />
                </Field>
                <Field label="Prazo de prestação de contas">
                  <input type="date" value={advanceDeadline} onChange={(e) => setAdvanceDeadline(e.target.value)} className="input" />
                </Field>
              </div>
            </div>
          )}

          <Field label="Observações para o aprovador" full>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Urgências, contexto ou aprovações prévias…"
              className="input min-h-16 resize-y"
              maxLength={4000}
            />
          </Field>

          {/* Documentos (anexados na submissão) */}
          <div className="rounded-lg border border-[var(--line)] px-4 py-3">
            <p className="text-sm font-medium">Documentos (opcional)</p>
            <p className="mt-0.5 text-xs text-[var(--faint)]">
              Anexe cotações e contratos agora. Nota fiscal, boleto e demais documentos são
              enviados após a aprovação, pela própria solicitação.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocumentType)}
                aria-label="Tipo de documento"
                className="input w-auto text-xs"
              >
                {CREATE_DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>
                ))}
              </select>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => addStagedFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                + Anexar PDF / imagem
              </button>
            </div>
            {stagedDocs.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {stagedDocs.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                  >
                    <span className="v-tabular rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--accent)]">
                      {DOC_TYPE_LABEL[d.docType]}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{d.file.name}</span>
                    <span className="v-tabular shrink-0 text-[10px] text-[var(--faint)]">
                      {Math.max(1, Math.round(d.file.size / 1024))} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => setStagedDocs((prev) => prev.filter((_, idx) => idx !== i))}
                      className="shrink-0 text-[var(--faint)] hover:text-[var(--rejected)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      aria-label={`Remover ${d.file.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {serverError && (
            <p
              role="alert"
              className="rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-4 py-2.5 text-sm text-[var(--rejected)]"
            >
              {serverError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] px-6 py-4">
          <div>
            <p className="v-tabular text-sm">
              <span className="text-[var(--muted)]">Total da solicitação </span>
              <span className="text-lg font-bold">{fmt(total)}</span>
            </p>
            {stagedDocs.length > 0 && (
              <p className="mt-0.5 v-tabular text-[11px] text-[var(--faint)]">
                {stagedDocs.length} documento(s) serão anexados.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => dismissRef.current()}
              className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={sending}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            >
              {sending ? "Enviando…" : "Enviar solicitação"}
            </button>
          </div>
        </div>
      </div>
    </div>
    {showNewForn && (
      <NewFornecedorModal
        costCenters={costCenters}
        supabaseToken={supabaseToken}
        onClose={() => setShowNewForn(false)}
        onCreated={(name) => {
          setShowNewForn(false);
          setNewFornNote(`"${name}" cadastrado — disponível para seleção após aprovação do Financeiro.`);
          onFornecedorCreated?.();
        }}
      />
    )}
    </>
  );
}

function Field({
  label,
  children,
  full,
  error,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  error?: string;
}) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
      {error && (
        <span className="mt-1 block text-xs text-[var(--rejected)]" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
