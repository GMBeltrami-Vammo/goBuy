"use client";

import { useEffect, useState } from "react";

/** Toggles the ambient aurora background (.fx-on on <html>), persisted to
 *  localStorage like the theme. Default on; bootstrap script sets it pre-paint. */
export function FxToggle() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    setOn(document.documentElement.classList.contains("fx-on"));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("fx-on");
    document.documentElement.classList.toggle("fx-on", next);
    try {
      localStorage.setItem("gobuy-fx", next ? "on" : "off");
    } catch {}
    setOn(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label="Alternar efeito de fundo"
      aria-pressed={on ?? undefined}
      title="Efeito de fundo"
      className={`flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        on ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {on === null ? (
        <span className="block h-4 w-4" />
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      )}
    </button>
  );
}
