"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { brtDateTimeBR, formatBRL, formatDateOnlyBR } from "@/lib/format";
import { formatAmount } from "@/lib/payment";
import { supabaseBrowser } from "@/lib/supabase/client";
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
 * Reclassifier queue (Bruna/Maria): charges a head sent for reclassification.
 * They assign the new cost center; the charge then returns to the new CC's head
 * as pending. Assign-only (no reject).
 */
export function ReclassDashboard({
  supabaseToken,
  allCostCenters,
}: {
  supabaseToken: string;
  allCostCenters: Pick<CostCenter, "id" | "code" | "name" | "department">[];
}) {
  const [charges, setCharges] = useState<IncomingCharge[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState<IncomingCharge | null>(null);
  const [newCc, setNewCc] = useState("");

  const ccById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of allCostCenters) m.set(c.id, `${c.code} — ${c.name}`);
    return m;
  }, [allCostCenters]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof allCostCenters>();
    for (const cc of allCostCenters) {
      const list = map.get(cc.department) ?? [];
      list.push(cc);
      map.set(cc.department, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [allCostCenters]);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser(supabaseToken)
      .from("incoming_charges")
      .select("*, cost_centers!incoming_charges_cost_center_id_fkey(code, name, department)")
      .eq("status", "reclassifying")
      .order("reclass_requested_at", { ascending: true })
      .limit(500);
    setCharges((data as unknown as IncomingCharge[]) ?? []);
  }, [supabaseToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAssign = (c: IncomingCharge) => {
    setNewCc(c.reclass_proposed_cc_id ? String(c.reclass_proposed_cc_id) : "");
    setAssignTarget(c);
  };

  const confirmAssign = async () => {
    if (!assignTarget) return;
    if (!newCc) {
      flash("Selecione o novo centro de custo.");
      return;
    }
    const target = assignTarget;
    const ccId = Number(newCc);
    setAssignTarget(null);
    setBusyIds((prev) => new Set(prev).add(target.id));
    setCharges((prev) => prev?.filter((x) => x.id !== target.id) ?? prev); // optimistic remove
    const { error } = await supabaseBrowser(supabaseToken).rpc("assign_reclassified_cc", {
      p_id: target.id,
      p_new_cc_id: ccId,
    });
    setBusyIds((prev) => {
      const n = new Set(prev);
      n.delete(target.id);
      return n;
    });
    if (error) {
      flash("Não foi possível atribuir o novo CC.");
      void load();
      return;
    }
    flash(`${target.display_id} → ${ccById.get(ccId) ?? "novo CC"}. Enviada ao novo head.`);
  };

  const list = charges ?? [];

  return (
    <div>
      <div className="reveal reveal-1">
        <h1 className="text-2xl font-bold tracking-tight">Reclassificações</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Cobranças que um head enviou para mudança de centro de custo. Atribua o novo CC — a cobrança
          volta para o head do novo centro aprovar.
        </p>
      </div>

      {toast && (
        <p
          role="status"
          className="reveal mt-5 rounded-lg border border-[var(--approved)] bg-[var(--approved-soft)] px-4 py-2.5 text-sm text-[var(--approved)]"
        >
          {toast}
        </p>
      )}

      <div className="reveal reveal-2 mt-7 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        {charges === null ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--faint)]">Carregando…</div>
        ) : list.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--faint)]">
            Nenhuma cobrança aguardando reclassificação.
          </p>
        ) : (
          <ul>
            {list.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    <span className="v-tabular text-[var(--accent)]">{c.display_id}</span> · {c.supplier_name}
                    <span className="ml-2 v-tabular text-xs font-normal text-[var(--muted)]">
                      {fmtMoney(Number(c.amount), c.currency)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    CC atual: {c.cost_centers ? `${c.cost_centers.code} — ${c.cost_centers.name}` : c.cost_center_id}
                    {c.reclass_proposed_cc_id && (
                      <>
                        {"  ·  "}
                        <span className="text-[var(--pending-text-strong)]">
                          Sugestão do head: {ccById.get(c.reclass_proposed_cc_id) ?? c.reclass_proposed_cc_id}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 v-tabular text-[11px] text-[var(--faint)]">
                    {c.reclass_requested_by ? `Solicitado por ${c.reclass_requested_by}` : "Solicitado"}
                    {c.due_date ? ` · vence ${formatDateOnlyBR(c.due_date)}` : ""}
                    {c.request_date ? ` · solicitação ${brtDateTimeBR(c.request_date)}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => openAssign(c)}
                  disabled={busyIds.has(c.id)}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                >
                  Atribuir novo CC
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {assignTarget && (
        <ConfirmDialog
          title={`Novo CC para ${assignTarget.display_id}`}
          message={`${assignTarget.supplier_name} — ${fmtMoney(Number(assignTarget.amount), assignTarget.currency)}. Selecione o centro de custo de destino; a cobrança irá ao head desse CC para aprovação.`}
          confirmLabel="Atribuir e enviar ao head"
          busy={busyIds.has(assignTarget.id)}
          onConfirm={() => void confirmAssign()}
          onCancel={() => setAssignTarget(null)}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Novo centro de custo</span>
            <select value={newCc} onChange={(e) => setNewCc(e.target.value)} className="input w-full text-sm" autoFocus>
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
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
