"use client";

import { useEffect } from "react";

import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

/**
 * Styled confirmation dialog — replaces native window.confirm/window.prompt so
 * destructive and irreversible actions match the rest of the UI and are
 * testable with normal DOM tooling. Pass `children` to add an input (e.g. a
 * payment reference), turning it into a prompt.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  useBodyScrollLock();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel, busy]);

  const confirmClass =
    tone === "danger"
      ? "bg-[var(--rejected)] text-[var(--on-status)]"
      : "bg-[var(--accent)] text-black";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal-enter w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
        <h2 className="text-base font-bold">{title}</h2>
        {message && <p className="mt-1.5 text-sm text-[var(--muted)]">{message}</p>}
        {children && <div className="mt-3">{children}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium transition hover:bg-[var(--surface-2)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${confirmClass}`}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
