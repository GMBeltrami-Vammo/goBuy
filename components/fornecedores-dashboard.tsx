"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { NewFornecedorModal } from "@/components/new-fornecedor-modal";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CostCenter, Fornecedor } from "@/lib/types";

export function FornecedoresDashboard({
  supabaseToken,
  costCenters,
}: {
  supabaseToken: string;
  costCenters: CostCenter[];
}) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Fornecedor | null>(null);
  const [showNew, setShowNew] = useState(false);
  const busyRef = useRef(false);

  const ccMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const cc of costCenters) m.set(cc.id, `${cc.code} — ${cc.name}`);
    return m;
  }, [costCenters]);

  const flash = (msg: string, ok = true) => {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoadError(false);
    const { data, error } = await supabaseBrowser(supabaseToken)
      .from("fornecedores")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[fornecedores] load failed:", error.message);
      setLoadError(true);
      setFornecedores([]);
      return;
    }
    setFornecedores((data as unknown as Fornecedor[]) ?? []);
  }, [supabaseToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = (fornecedores ?? []).filter((f) => f.status === "pending");
  const approved = (fornecedores ?? []).filter((f) => f.status === "approved" && f.active);

  const approve = async (f: Fornecedor) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(f.id);
    const { error } = await supabaseBrowser(supabaseToken).rpc("approve_fornecedor", { p_id: f.id });
    busyRef.current = false;
    setBusyId(null);
    if (error) {
      flash(error.message || "Erro ao aprovar fornecedor.", false);
      return;
    }
    flash(`${f.razao_social} aprovado.`);
    void load();
  };

  const confirmRemove = async () => {
    if (!removeTarget || busyRef.current) return;
    busyRef.current = true;
    setBusyId(removeTarget.id);
    const target = removeTarget;
    const { error } = await supabaseBrowser(supabaseToken).rpc("remove_fornecedor", { p_id: target.id });
    busyRef.current = false;
    setBusyId(null);
    setRemoveTarget(null);
    if (error) {
      flash(error.message || "Erro ao remover fornecedor.", false);
      return;
    }
    flash(`${target.razao_social} removido.`);
    void load();
  };

  const openContract = async (f: Fornecedor) => {
    const res = await fetch(`/api/fornecedores/${f.id}/contract`);
    if (!res.ok) {
      flash("Não foi possível abrir o contrato.", false);
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-10">
      <div className="reveal reveal-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Aprove novos cadastros e gerencie os fornecedores ativos.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-black shadow-[var(--shadow)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          + Novo fornecedor
        </button>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-[var(--shadow)] ${
            toast.ok
              ? "border-[var(--approved)] bg-[var(--approved-soft)] text-[var(--approved)]"
              : "border-[var(--rejected)] bg-[var(--rejected-soft)] text-[var(--rejected)]"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {removeTarget && (
        <ConfirmDialog
          title={`Remover ${removeTarget.razao_social}?`}
          message="O fornecedor deixará de aparecer para novas solicitações. As solicitações passadas mantêm os dados. Esta ação pode ser refeita apenas com um novo cadastro."
          confirmLabel="Remover fornecedor"
          tone="danger"
          busy={busyId === removeTarget.id}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoveTarget(null)}
        />
      )}

      {loadError && (
        <p className="rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-4 py-2.5 text-sm text-[var(--rejected)]">
          Não foi possível carregar os fornecedores.
        </p>
      )}

      {/* Pendentes */}
      <section className="reveal reveal-2">
        <h2 className="mb-3 v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
          Aguardando aprovação{fornecedores && pending.length > 0 ? ` · ${pending.length}` : ""}
        </h2>
        {fornecedores === null ? (
          <SkeletonCard />
        ) : pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--line)] px-5 py-8 text-center text-sm text-[var(--faint)]">
            Nenhum fornecedor aguardando aprovação.
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--pending)] bg-[var(--pending-soft)] px-5 py-3.5"
              >
                <div className="min-w-0">
                  <FornecedorSummary f={f} ccLabel={f.default_cost_center_id ? ccMap.get(f.default_cost_center_id) : undefined} />
                  {f.created_by_email && (
                    <p className="mt-0.5 text-[11px] text-[var(--faint)]">Cadastrado por {f.created_by_email}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {f.contract_storage_path && (
                    <button
                      onClick={() => void openContract(f)}
                      className="text-xs font-medium text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      Contrato
                    </button>
                  )}
                  <button
                    onClick={() => setRemoveTarget(f)}
                    disabled={busyId === f.id}
                    className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--surface-2)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Recusar
                  </button>
                  <button
                    onClick={() => void approve(f)}
                    disabled={busyId === f.id}
                    className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-bold text-black transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  >
                    {busyId === f.id ? "…" : "Aprovar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Aprovados */}
      <section className="reveal reveal-3">
        <h2 className="mb-3 v-tabular text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">
          Fornecedores ativos{fornecedores && approved.length > 0 ? ` · ${approved.length}` : ""}
        </h2>
        {fornecedores === null ? (
          <SkeletonCard />
        ) : approved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--line)] px-5 py-8 text-center text-sm text-[var(--faint)]">
            Nenhum fornecedor ativo ainda.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
            <ul>
              {approved.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <FornecedorSummary f={f} ccLabel={f.default_cost_center_id ? ccMap.get(f.default_cost_center_id) : undefined} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {f.contract_storage_path && (
                      <button
                        onClick={() => void openContract(f)}
                        className="text-xs font-medium text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        Contrato
                      </button>
                    )}
                    <button
                      onClick={() => setRemoveTarget(f)}
                      disabled={busyId === f.id}
                      className="rounded text-xs text-[var(--faint)] transition hover:text-[var(--rejected)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      Remover
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {showNew && (
        <NewFornecedorModal
          costCenters={costCenters}
          supabaseToken={supabaseToken}
          onClose={() => setShowNew(false)}
          onCreated={(name) => {
            setShowNew(false);
            flash(`${name} cadastrado — aguardando aprovação.`);
            void load();
          }}
        />
      )}
    </div>
  );
}

function FornecedorSummary({ f, ccLabel }: { f: Fornecedor; ccLabel?: string }) {
  const pay =
    f.payment_default === "bank"
      ? `Transferência · ${f.banco ?? ""} Ag. ${f.agencia ?? ""} / ${f.conta ?? ""}`
      : f.pix_key
        ? `PIX · ${f.pix_key}`
        : f.banco
          ? `Transferência · ${f.banco} Ag. ${f.agencia ?? ""} / ${f.conta ?? ""}`
          : "—";
  return (
    <>
      <p className="truncate text-sm font-semibold">
        {f.razao_social}
        <span className="ml-2 v-tabular text-xs font-normal text-[var(--muted)]">{f.document}</span>
      </p>
      <p className="truncate text-xs text-[var(--muted)]">{pay}</p>
      {ccLabel && <p className="truncate text-[11px] text-[var(--faint)]">CC padrão: {ccLabel}</p>}
    </>
  );
}

function SkeletonCard() {
  return (
    <div className="space-y-2" role="status" aria-label="Carregando fornecedores">
      {[0, 1].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--surface-2)]" />
      ))}
    </div>
  );
}
