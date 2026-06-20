"use client";

import { useEffect, useState } from "react";

type FxMode = "circuit" | "aurora" | "sphere" | "off";

// Cycle order: circuit (network) → aurora (neon glow) → sphere (blue orb) → off.
const ORDER: FxMode[] = ["circuit", "aurora", "sphere", "off"];

const LABEL: Record<FxMode, string> = {
  circuit: "rede",
  aurora: "aurora",
  sphere: "esfera",
  off: "desligado",
};

function readMode(): FxMode {
  const c = document.documentElement.classList;
  if (c.contains("fx-aurora")) return "aurora";
  if (c.contains("fx-sphere")) return "sphere";
  if (c.contains("fx-circuit")) return "circuit";
  return "off";
}

function applyMode(mode: FxMode) {
  const c = document.documentElement.classList;
  c.remove("fx-aurora", "fx-circuit", "fx-sphere");
  if (mode === "aurora") c.add("fx-aurora");
  else if (mode === "circuit") c.add("fx-circuit");
  else if (mode === "sphere") c.add("fx-sphere");
  try {
    localStorage.setItem("gobuy-fx", mode);
  } catch {}
}

/** Cycles the ambient background through circuit → aurora → off, persisted to
 *  localStorage like the theme. The bootstrap script sets it pre-paint. */
export function FxToggle() {
  const [mode, setMode] = useState<FxMode | null>(null);

  useEffect(() => {
    setMode(readMode());
  }, []);

  const cycle = () => {
    const current = readMode();
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    applyMode(next);
    setMode(next);
  };

  const isOff = mode === "off";

  return (
    <button
      onClick={cycle}
      aria-label={mode ? `Efeito de fundo: ${LABEL[mode]} (clique para alternar)` : "Efeito de fundo"}
      title={mode ? `Efeito de fundo: ${LABEL[mode]}` : "Efeito de fundo"}
      className={`flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        isOff ? "text-[var(--muted)] hover:text-[var(--ink)]" : "text-[var(--accent)]"
      }`}
    >
      {mode === null ? (
        <span className="block h-4 w-4" />
      ) : mode === "circuit" ? (
        // Network nodes
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="6" r="2" />
          <circle cx="19" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M6.8 7.2 10.2 16.2M17.2 7.2 13.8 16.2M7 6h10" />
        </svg>
      ) : mode === "aurora" ? (
        // Glow / sparkle
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      ) : mode === "sphere" ? (
        // Orb — concentric circles
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        // Off
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M6 6l12 12" />
        </svg>
      )}
    </button>
  );
}
