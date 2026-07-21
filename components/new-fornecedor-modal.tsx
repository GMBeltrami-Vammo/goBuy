"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { CostCenter } from "@/lib/types";

/**
 * Registration form for a new fornecedor. Registers as `pending` (Finance must
 * approve before it can be selected on a request). Reused by the Finance
 * dashboard and inline from the new-request modal.
 */
export function NewFornecedorModal({
  costCenters,
  supabaseToken,
  onClose,
  onCreated,
}: {
  costCenters: CostCenter[];
  supabaseToken: string;
  onClose: () => void;
  onCreated: (razaoSocial: string) => void;
}) {
  useBodyScrollLock();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const [razao, setRazao] = useState("");
  const [doc, setDoc] = useState("");
  const [banco, setBanco] = useState("");
  const [agencia, setAgencia] = useState("");
  const [conta, setConta] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [paymentDefault, setPaymentDefault] = useState<"bank" | "pix">("pix");
  const [ccId, setCcId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [contractWarning, setContractWarning] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const submittingRef = useRef(false);

  const grouped = useMemo(() => {
    const map = new Map<string, CostCenter[]>();
    for (const cc of costCenters) {
      const list = map.get(cc.department) ?? [];
      list.push(cc);
      map.set(cc.department, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [costCenters]);

  const hasBank = !!(banco.trim() && agencia.trim() && conta.trim());
  const hasPix = !!pixKey.trim();
  const bankPartial = !!(banco.trim() || agencia.trim() || conta.trim()) && !hasBank;

  const submit = async () => {
    if (submittingRef.current) return;
    const errs: Record<string, string> = {};
    if (!razao.trim()) errs.razao = "Informe a razão social.";
    if (!doc.trim()) errs.doc = "Informe o CNPJ ou CPF.";
    if (!hasBank && !hasPix)
      errs.payment = "Informe uma chave PIX ou os dados bancários completos (banco, agência e conta).";
    else if (bankPartial)
      errs.payment = "Para pagamento por transferência, preencha banco, agência e conta.";

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setServerError(null);

    const payload = {
      razao_social: razao.trim(),
      document: doc.trim(),
      banco: hasBank ? banco.trim() : null,
      agencia: hasBank ? agencia.trim() : null,
      conta: hasBank ? conta.trim() : null,
      pix_key: hasPix ? pixKey.trim() : null,
      payment_default: hasBank && hasPix ? paymentDefault : null,
      default_cost_center_id: ccId ? Number(ccId) : null,
    };

    submittingRef.current = true;
    setSending(true);

    const { data: newId, error } = await supabaseBrowser(supabaseToken).rpc(
      "register_fornecedor",
      { p_payload: payload },
    );

    if (error) {
      submittingRef.current = false;
      setSending(false);
      setServerError(error.message || "Erro ao cadastrar fornecedor.");
      return;
    }

    // Optional contract PDF — the fornecedor already exists, so a failure here
    // is non-fatal: register succeeds and the contract can be attached later.
    let warn: string | null = null;
    if (file && newId != null) {
      try {
        const form = new FormData();
        form.set("file", file);
        const up = await fetch(`/api/fornecedores/${newId}/contract`, {
          method: "POST",
          body: form,
        });
        if (!up.ok) {
          warn = "O contrato não pôde ser anexado — envie novamente pela lista de fornecedores.";
        }
      } catch {
        warn = "O contrato não pôde ser anexado — envie novamente pela lista de fornecedores.";
      }
    }

    setSending(false);
    submittingRef.current = false;
    // If the contract failed, hold the modal open so the user sees why (they can
    // then click Concluir); otherwise close immediately.
    if (warn) {
      setContractWarning(warn);
      return;
    }
    onCreated(razao.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-enter w-full max-w-xl rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <h2 className="text-lg font-bold">Novo fornecedor</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-[var(--faint)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <p className="rounded-lg border border-[var(--pending)] bg-[var(--pending-soft)] px-4 py-2.5 text-xs text-[var(--pending-text-strong)]">
            O fornecedor entra como <strong>pendente</strong> e só poderá ser usado em solicitações após
            a aprovação do Financeiro.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razão social" error={fieldErrors.razao} full>
              <input
                value={razao}
                onChange={(e) => { setRazao(e.target.value); if (fieldErrors.razao) setFieldErrors((p) => ({ ...p, razao: "" })); }}
                placeholder="Nome / razão social do fornecedor"
                className="input"
                maxLength={200}
              />
            </Field>
            <Field label="CNPJ / CPF" error={fieldErrors.doc} full>
              <input
                value={doc}
                onChange={(e) => { setDoc(e.target.value); if (fieldErrors.doc) setFieldErrors((p) => ({ ...p, doc: "" })); }}
                placeholder="00.000.000/0001-00 ou 000.000.000-00"
                className="input"
                maxLength={40}
              />
            </Field>
          </div>

          {/* Payment data */}
          <div className="rounded-lg border border-[var(--line)] px-4 py-3">
            <p className="text-sm font-medium">Dados de pagamento</p>
            <p className="mt-0.5 text-xs text-[var(--faint)]">
              Informe a chave PIX, os dados bancários, ou ambos. Ao preencher os dois, escolha o padrão.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Chave PIX">
                <input
                  value={pixKey}
                  onChange={(e) => { setPixKey(e.target.value); if (fieldErrors.payment) setFieldErrors((p) => ({ ...p, payment: "" })); }}
                  placeholder="CNPJ, e-mail, telefone ou aleatória"
                  className="input"
                  maxLength={200}
                />
              </Field>
              <Field label="Banco">
                <input
                  value={banco}
                  onChange={(e) => { setBanco(e.target.value); if (fieldErrors.payment) setFieldErrors((p) => ({ ...p, payment: "" })); }}
                  placeholder="Ex: Itaú (341)"
                  className="input"
                  maxLength={200}
                />
              </Field>
              <Field label="Agência">
                <input
                  value={agencia}
                  onChange={(e) => { setAgencia(e.target.value); if (fieldErrors.payment) setFieldErrors((p) => ({ ...p, payment: "" })); }}
                  placeholder="0000"
                  className="input"
                  maxLength={200}
                />
              </Field>
              <Field label="Conta">
                <input
                  value={conta}
                  onChange={(e) => { setConta(e.target.value); if (fieldErrors.payment) setFieldErrors((p) => ({ ...p, payment: "" })); }}
                  placeholder="00000-0"
                  className="input"
                  maxLength={200}
                />
              </Field>
            </div>
            {hasBank && hasPix && (
              <div className="mt-3">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Método padrão</span>
                <div className="flex gap-2" role="group" aria-label="Método de pagamento padrão">
                  {([["pix", "PIX"], ["bank", "Transferência"]] as [("pix" | "bank"), string][]).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentDefault(m)}
                      aria-pressed={paymentDefault === m}
                      className={`rounded-lg border px-4 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        paymentDefault === m
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--ink)]"
                          : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {fieldErrors.payment && (
              <p className="mt-2 text-xs text-[var(--rejected)]" role="alert">{fieldErrors.payment}</p>
            )}
          </div>

          {/* Optional default CC + contract */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Centro de custo padrão (opcional)">
              <select value={ccId} onChange={(e) => setCcId(e.target.value)} className="input">
                <option value="">Nenhum — usar o mais frequente</option>
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
            <Field label="Contrato / proposta (PDF, opcional)">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-2 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {file ? "Trocar PDF" : "+ Anexar PDF"}
                </button>
                {file && (
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]" title={file.name}>
                    {file.name}
                  </span>
                )}
              </div>
            </Field>
          </div>

          {contractWarning && (
            <p
              role="alert"
              className="rounded-lg border border-[var(--awaiting-payment)] bg-[var(--pending-soft)] px-4 py-2.5 text-sm text-[var(--pending-text-strong)]"
            >
              Fornecedor cadastrado. {contractWarning}
            </p>
          )}
          {serverError && (
            <p
              role="alert"
              className="rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-4 py-2.5 text-sm text-[var(--rejected)]"
            >
              {serverError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
          {contractWarning ? (
            <button
              onClick={() => onCreated(razao.trim())}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-black transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            >
              Concluir
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Cancelar
              </button>
              <button
                onClick={() => void submit()}
                disabled={sending}
                className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
              >
                {sending ? "Cadastrando…" : "Cadastrar fornecedor"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
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
