"use client";

import { useMemo, useState } from "react";

import { formatBRL } from "@/lib/format";
import { CURRENCIES, CURRENCY_CUSTOM, formatAmount } from "@/lib/payment";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { CostCenter, RequestType } from "@/lib/types";

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
  onClose,
  onSubmitted,
}: {
  costCenters: CostCenter[];
  onClose: () => void;
  onSubmitted: (displayId: string) => void;
}) {
  useBodyScrollLock();
  const [type, setType] = useState<RequestType>("products");
  const [supplier, setSupplier] = useState("");
  const [supplierDoc, setSupplierDoc] = useState("");
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
  const [splitDepts, setSplitDepts] = useState(false);
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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

  const submit = async () => {
    setError(null);
    if (!supplier.trim()) return setError(isAdvance ? "Informe o beneficiário." : "Informe o fornecedor.");
    if (!ccId) return setError("Selecione o centro de custo.");
    if (currency === CURRENCY_CUSTOM && !/^[A-Z]{2,10}$/.test(customCurrency.trim().toUpperCase()))
      return setError("Informe um código de moeda válido (ex: CLP, CHF).");
    if (type === "products" && items.every((i) => !i.description.trim()))
      return setError("Adicione ao menos um item.");
    if (total <= 0) return setError("O valor total deve ser maior que zero.");
    if (splitDepts) {
      if (allocations.length < 2) return setError("Rateio exige ao menos dois departamentos.");
      if (allocations.some((a) => !a.ccId))
        return setError("Selecione o centro de custo em cada linha do rateio.");
      if (allocations.slice(0, -1).some((a) => (parseFloat(a.percentage) || 0) <= 0))
        return setError("Cada departamento do rateio precisa de um percentual maior que zero.");
      if (lastPct <= 0)
        return setError(
          `Os demais departamentos já somam ${othersSum.toFixed(2).replace(".", ",")}%. Reduza para liberar o último.`,
        );
    }

    const payload: Record<string, unknown> = {
      request_type: type,
      supplier_name: supplier.trim(),
      supplier_document: supplierDoc.trim() || null,
      cost_center_id: Number(ccId),
      justification: justification.trim() || null,
      notes: notes.trim() || null,
      currency: activeCurrency || "BRL",
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

    setSending(true);
    let res: Response;
    try {
      res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setSending(false);
      setError("Erro de rede. Verifique sua conexão e tente novamente.");
      return;
    }
    setSending(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setError(body.error ?? "Erro ao enviar solicitação.");
      return;
    }

    const data = await res.json() as { display_id: string };
    onSubmitted(data.display_id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-enter w-full max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <h2 className="text-lg font-bold">Nova solicitação</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[var(--faint)] hover:text-[var(--ink)]">✕</button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Type */}
          <div className="flex flex-wrap gap-2">
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
                className={`rounded-lg border px-4 py-2 text-sm transition ${
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
            <Field label={isAdvance ? "Nome do beneficiário" : "Nome do fornecedor"}>
              <input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder={isAdvance ? "Quem receberá o adiantamento" : "Razão social"}
                className="input"
                maxLength={200}
              />
            </Field>
            <Field label={isAdvance ? "CPF" : "CNPJ"}>
              <input
                value={supplierDoc}
                onChange={(e) => setSupplierDoc(e.target.value)}
                placeholder={isAdvance ? "000.000.000-00" : "00.000.000/0001-00"}
                className="input"
                maxLength={20}
              />
            </Field>
            <Field label="Centro de custo">
              <select value={ccId} onChange={(e) => setCcId(e.target.value)} className="input">
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
            <Field label="Moeda">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
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
                      { ccId: "", percentage: "" }, // last = computed remainder
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
                      // Freeze the current computed remainder into the previously-last
                      // row, then append a fresh row that becomes the new remainder.
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
                    className="text-sm font-semibold text-[var(--accent)] hover:underline"
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
                            onChange={(e) => setItem(i, { description: e.target.value })}
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
                            onChange={(e) => setItem(i, { unit_value: e.target.value })}
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
                <button
                  onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
                  className="text-sm font-semibold text-[var(--accent)] hover:underline"
                >
                  + Adicionar item
                </button>
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
              <Field label={`Valor do contrato (${currency})`}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={serviceValue}
                  onChange={(e) => setServiceValue(e.target.value)}
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
              <p className="rounded-lg border border-[var(--pending)] bg-[var(--pending-soft)] px-4 py-2.5 text-xs text-[var(--pending)]">
                Adiantamentos exigem prestação de contas. Valores acima de R$ 5.000 passam por
                validação adicional do Financeiro.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Valor (${currency})`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={advanceValue}
                    onChange={(e) => setAdvanceValue(e.target.value)}
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

          {error && (
            <p className="rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-4 py-2.5 text-sm text-[var(--rejected)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] px-6 py-4">
          <p className="v-tabular text-sm">
            <span className="text-[var(--muted)]">Total da solicitação </span>
            <span className="text-lg font-bold">{fmt(total)}</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-2)]"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={sending}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              {sending ? "Enviando…" : "Enviar solicitação"}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
