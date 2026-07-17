"use client";

import { useEffect, useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { RateioLine } from "@/components/rateio-line";
import { formatBRL, formatDateOnlyBR } from "@/lib/format";
import { formatAmount } from "@/lib/payment";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { CostCenter, IncomingCharge } from "@/lib/types";

function fmtMoney(n: number, currency: string): string {
  if (!currency || currency === "BRL") return formatBRL(n);
  try {
    return formatAmount(n, currency);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/**
 * Budget-focused drill-down for one cost center: budget consumption chart,
 * the pending charges (approve/deny inline, so the head can decide against
 * live budget data), and the month's decided charges. Mirrors the head
 * window's BudgetDetailModal, adapted to incoming_charges.
 *
 * Budget math is BRL-only (budgets are in BRL, no FX); the lists still show
 * charges in any currency so they can be acted on.
 */
export function ChargeDetailModal({
  center,
  budget,
  charges,
  monthStart,
  busyId,
  onApprove,
  onDeny,
  onClose,
}: {
  center: CostCenter;
  budget: number;
  charges: IncomingCharge[];
  monthStart: string;
  busyId: string | null;
  onApprove: (c: IncomingCharge) => void;
  onDeny: (c: IncomingCharge) => void;
  onClose: () => void;
}) {
  useBodyScrollLock();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const monthKey = monthStart.slice(0, 7);
  const forCc = useMemo(
    () => charges.filter((c) => c.cost_center_id === center.id),
    [charges, center.id],
  );

  // Budget math: approved + pending, BRL only, bucketed by due-date month.
  const brlThisMonth = useMemo(
    () =>
      forCc.filter(
        (c) =>
          (c.status === "approved" || c.status === "pending") &&
          (c.currency ?? "BRL") === "BRL" &&
          !!c.due_date &&
          c.due_date.slice(0, 7) === monthKey,
      ),
    [forCc, monthKey],
  );
  const committed = brlThisMonth.reduce((a, c) => a + Number(c.amount), 0);
  const pendingBrl = brlThisMonth
    .filter((c) => c.status === "pending")
    .reduce((a, c) => a + Number(c.amount), 0);
  const available = Math.max(0, budget - committed);
  const pct = budget > 0 ? Math.round((committed / budget) * 100) : 0;

  // Pending charges for this CC in the month (any currency) — the actionable list.
  const pending = useMemo(
    () =>
      forCc.filter(
        (c) => c.status === "pending" && !!c.due_date && c.due_date.slice(0, 7) === monthKey,
      ),
    [forCc, monthKey],
  );
  const decided = useMemo(
    () =>
      forCc.filter(
        (c) => c.status !== "pending" && !!c.due_date && c.due_date.slice(0, 7) === monthKey,
      ),
    [forCc, monthKey],
  );

  // Daily series (BRL committed per due-date day + cumulative).
  const daily = useMemo(() => {
    const [y, m] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const perDay = new Map<number, number>();
    for (const c of brlThisMonth) {
      const day = Number(c.due_date!.slice(8, 10));
      perDay.set(day, (perDay.get(day) ?? 0) + Number(c.amount));
    }
    let acc = 0;
    const rows: { day: number; valor: number; acumulado: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const v = perDay.get(d) ?? 0;
      acc += v;
      rows.push({ day: d, valor: v, acumulado: acc });
    }
    return rows;
  }, [brlThisMonth, monthKey]);

  const monthLabel = new Date(`${monthStart}T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-enter w-full max-w-3xl rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
          <div>
            <p className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">
              {center.code} · {center.department}
            </p>
            <h2 className="text-lg font-bold">{center.name}</h2>
            <p className="text-xs capitalize text-[var(--muted)]">{monthLabel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-[var(--faint)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Budget" value={formatBRL(budget)} />
            <MiniStat
              label={`Comprometido (${pct}%)`}
              value={formatBRL(committed)}
              tone={committed > budget && budget > 0 ? "rejected" : "pending"}
            />
            <MiniStat label="Disponível" value={formatBRL(available)} tone="approved" />
            <MiniStat label="Pendente (R$)" value={formatBRL(pendingBrl)} />
          </div>

          <section>
            <h3 className="mb-2 v-tabular text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--faint)]">
              Consumo por dia (vencimento, R$)
            </h3>
            {daily.every((d) => d.valor === 0) ? (
              <p className="rounded-lg border border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--faint)]">
                Nenhum gasto comprometido em R$ neste mês.
              </p>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--faint)" }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                    <YAxis
                      domain={budget > 0 ? [0, Math.max(committed, budget) * 1.05] : [0, "auto"]}
                      tick={{ fontSize: 10, fill: "var(--faint)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      width={44}
                    />
                    <Tooltip
                      formatter={(value, name) => [formatBRL(Number(value)), name === "valor" ? "No dia" : "Acumulado"]}
                      labelFormatter={(day) => `Dia ${day}`}
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, color: "var(--ink)" }}
                    />
                    {budget > 0 && (
                      <ReferenceLine y={budget} stroke="var(--rejected)" strokeDasharray="6 4" label={{ value: "Budget", position: "insideTopRight", fontSize: 10, fill: "var(--rejected)" }} />
                    )}
                    <Bar dataKey="valor" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Line type="monotone" dataKey="acumulado" stroke="var(--awaiting-payment)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 v-tabular text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--faint)]">
              Pendentes de aprovação · {pending.length}
            </h3>
            {pending.length === 0 ? (
              <p className="rounded-lg border border-[var(--line)] px-4 py-6 text-center text-sm text-[var(--faint)]">
                Nenhuma cobrança pendente neste mês.
              </p>
            ) : (
              <ul className="rounded-lg border border-[var(--line)]">
                {pending.map((c) => (
                  <li key={c.id} className="border-b border-[var(--line)] px-4 py-2.5 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="v-tabular text-xs font-semibold text-[var(--accent)]">{c.display_id}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {c.supplier_name}
                        {c.due_date && (
                          <span className="ml-2 v-tabular text-[11px] text-[var(--faint)]">
                            venc. {formatDateOnlyBR(c.due_date)}
                          </span>
                        )}
                      </span>
                      <span className="v-tabular text-sm font-semibold text-[var(--pending)]">
                        {fmtMoney(Number(c.amount), c.currency)}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onApprove(c)}
                          disabled={busyId === c.id}
                          className="rounded-lg bg-[var(--approved)] px-3 py-1 text-xs font-bold text-[var(--on-status)] transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          {busyId === c.id ? "…" : "Aprovar"}
                        </button>
                        <button
                          onClick={() => onDeny(c)}
                          disabled={busyId === c.id}
                          className="rounded-lg border border-[var(--rejected)] px-3 py-1 text-xs font-bold text-[var(--rejected)] transition hover:bg-[var(--rejected-soft)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          Recusar
                        </button>
                      </div>
                    </div>
                    <RateioLine observation={c.observation} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {decided.length > 0 && (
            <section>
              <h3 className="mb-2 v-tabular text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--faint)]">
                Decididas no mês · {decided.length}
              </h3>
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-[var(--line)]">
                {decided.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-sm last:border-b-0">
                    <span className="v-tabular text-xs font-semibold text-[var(--accent)]">{c.display_id}</span>
                    <span className="min-w-0 flex-1 truncate">{c.supplier_name}</span>
                    <span className="v-tabular text-sm font-semibold">{fmtMoney(Number(c.amount), c.currency)}</span>
                    <span
                      className="v-tabular text-[11px] font-semibold"
                      style={{ color: c.status === "approved" ? "var(--approved)" : "var(--rejected)" }}
                    >
                      {c.status === "approved" ? "Aprovada" : "Recusada"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pending" | "approved" | "rejected";
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <p className="v-tabular text-[9px] uppercase tracking-[0.15em] text-[var(--muted)]">{label}</p>
      <p
        className="mt-1 truncate v-tabular text-sm font-bold"
        style={tone ? { color: `var(--${tone})` } : undefined}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
