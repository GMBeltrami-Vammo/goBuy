"use client";

import { useCallback, useEffect, useState } from "react";

import { brtYmd, formatDateOnlyBR, isInvalidDMY, maskDMY, parseDMY } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { ChargeDelegation } from "@/lib/types";

const VAMMO = "@vammo.com";

type Phase = "active" | "scheduled" | "ended" | "revoked";

function phaseOf(d: ChargeDelegation, today: string): Phase {
  if (d.revoked_at) return "revoked";
  if (d.ends_on < today) return "ended";
  if (d.starts_on > today) return "scheduled";
  return "active";
}

const PHASE_LABEL: Record<Phase, string> = {
  active: "Ativa",
  scheduled: "Agendada",
  ended: "Encerrada",
  revoked: "Cancelada",
};
// Explicit color + background tokens (no reliance on a "-soft" for every tone).
const PHASE_STYLE: Record<Phase, { color: string; bg: string }> = {
  active: { color: "var(--approved)", bg: "var(--approved-soft)" },
  scheduled: { color: "var(--pending)", bg: "var(--pending-soft)" },
  ended: { color: "var(--faint)", bg: "var(--surface-2)" },
  revoked: { color: "var(--rejected)", bg: "var(--rejected-soft)" },
};

/**
 * Férias — a head appoints a substitute to answer their charges for a date
 * window. Access is granted/expired by the server (RLS date check); this dialog
 * just creates, lists and cancels the delegations the head owns.
 */
export function FeriasDialog({
  supabaseToken,
  email,
  onClose,
}: {
  supabaseToken: string;
  email: string;
  onClose: () => void;
}) {
  useBodyScrollLock();
  const [rows, setRows] = useState<ChargeDelegation[] | null>(null);
  const [delegate, setDelegate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const today = brtYmd(new Date().toISOString());

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser(supabaseToken)
      .from("charge_delegations")
      .select("*")
      .eq("delegator_email", email)
      .order("starts_on", { ascending: false });
    setRows((data as unknown as ChargeDelegation[]) ?? []);
  }, [supabaseToken, email]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose, busy]);

  const flash = (tone: "ok" | "err", text: string) => {
    setMsg({ tone, text });
    if (tone === "ok") window.setTimeout(() => setMsg(null), 4000);
  };

  const create = async () => {
    const em = delegate.trim().toLowerCase();
    const startYmd = parseDMY(from);
    const endYmd = parseDMY(to);
    if (!em.endsWith(VAMMO)) return flash("err", "Informe um e-mail @vammo.com para o substituto.");
    if (em === email.toLowerCase()) return flash("err", "Você não pode delegar para si mesmo.");
    if (!startYmd || !endYmd) return flash("err", "Preencha início e fim (dd/mm/aaaa).");
    if (endYmd < startYmd) return flash("err", "A data final deve ser igual ou posterior à inicial.");
    if (endYmd < today) return flash("err", "A janela informada já terminou.");

    setBusy(true);
    const { error } = await supabaseBrowser(supabaseToken).rpc("assign_charge_delegate", {
      p_delegate_email: em,
      p_starts_on: startYmd,
      p_ends_on: endYmd,
    });
    setBusy(false);
    if (error) return flash("err", error.message || "Não foi possível alocar o substituto.");
    setDelegate("");
    setFrom("");
    setTo("");
    flash("ok", `${em} pode responder suas cobranças de ${formatDateOnlyBR(startYmd)} a ${formatDateOnlyBR(endYmd)}.`);
    void load();
  };

  const revoke = async (d: ChargeDelegation) => {
    setBusy(true);
    setRows((prev) => prev?.map((x) => (x.id === d.id ? { ...x, revoked_at: new Date().toISOString() } : x)) ?? prev);
    const { error } = await supabaseBrowser(supabaseToken).rpc("revoke_charge_delegate", { p_id: d.id });
    setBusy(false);
    if (error) {
      flash("err", error.message || "Não foi possível cancelar.");
      void load();
      return;
    }
    flash("ok", `Delegação para ${d.delegate_email} cancelada.`);
  };

  const list = rows ?? [];
  const dateBad = isInvalidDMY(from) || isInvalidDMY(to);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Delegar aprovação — ausência"
    >
      <div className="modal-enter w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">🏖️ Delegar aprovação (ausência)</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Aloque um substituto para responder suas cobranças durante uma janela. Passada a data final,
              o acesso dele é removido automaticamente.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
            className="shrink-0 rounded text-lg leading-none text-[var(--faint)] transition hover:text-[var(--ink)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            ✕
          </button>
        </div>

        {msg && (
          <p
            role="status"
            className="mt-3 rounded-lg border px-3 py-2 text-sm"
            style={{
              color: `var(--${msg.tone === "ok" ? "approved" : "rejected"})`,
              borderColor: `var(--${msg.tone === "ok" ? "approved" : "rejected"})`,
              backgroundColor: `var(--${msg.tone === "ok" ? "approved" : "rejected"}-soft)`,
            }}
          >
            {msg.text}
          </p>
        )}

        {/* New delegation */}
        <div className="mt-4 space-y-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">E-mail do substituto</span>
            <input
              type="email"
              value={delegate}
              onChange={(e) => setDelegate(e.target.value)}
              placeholder="nome@vammo.com"
              autoFocus
              className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-sm outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">De</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={10}
                placeholder="dd/mm/aaaa"
                value={from}
                onChange={(e) => setFrom(maskDMY(e.target.value))}
                aria-invalid={isInvalidDMY(from)}
                className={`w-full rounded-md border bg-[var(--surface)] px-2.5 py-1.5 text-sm outline-none transition focus:border-[var(--accent)] ${
                  isInvalidDMY(from) ? "border-[var(--rejected)]" : "border-[var(--line-strong)]"
                }`}
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Até</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={10}
                placeholder="dd/mm/aaaa"
                value={to}
                onChange={(e) => setTo(maskDMY(e.target.value))}
                aria-invalid={isInvalidDMY(to)}
                className={`w-full rounded-md border bg-[var(--surface)] px-2.5 py-1.5 text-sm outline-none transition focus:border-[var(--accent)] ${
                  isInvalidDMY(to) ? "border-[var(--rejected)]" : "border-[var(--line-strong)]"
                }`}
              />
            </label>
          </div>
          {dateBad && <p className="text-[11px] text-[var(--rejected)]">Data inválida.</p>}
          <button
            onClick={() => void create()}
            disabled={busy || dateBad}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {busy ? "…" : "Alocar substituto"}
          </button>
        </div>

        {/* Existing delegations */}
        <div className="mt-4">
          <p className="v-tabular text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
            Delegações
          </p>
          {rows === null ? (
            <p className="mt-2 text-sm text-[var(--faint)]">Carregando…</p>
          ) : list.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--faint)]">Nenhuma delegação criada.</p>
          ) : (
            <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
              {list.map((d) => {
                const ph = phaseOf(d, today);
                const canCancel = ph === "active" || ph === "scheduled";
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.delegate_email}</p>
                      <p className="v-tabular text-[11px] text-[var(--muted)]">
                        {formatDateOnlyBR(d.starts_on)} — {formatDateOnlyBR(d.ends_on)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 v-tabular text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: PHASE_STYLE[ph].color, backgroundColor: PHASE_STYLE[ph].bg }}
                      >
                        {PHASE_LABEL[ph]}
                      </span>
                      {canCancel && (
                        <button
                          onClick={() => void revoke(d)}
                          disabled={busy}
                          className="rounded text-[11px] font-semibold text-[var(--rejected)] transition hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
