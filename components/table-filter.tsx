"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { SortDir } from "@/components/table-sort";

export interface FilterOption {
  value: string; // "" represents blanks
  label: string;
}

const POP_WIDTH = 248;

/**
 * A spreadsheet-style column header: a clickable label that opens a dropdown with
 * sort (crescente/decrescente) and — when `options` are given — a value filter
 * (search + Selecionar todos/Limpar + checkbox list, "(Vazias)" for empty values).
 *
 * The `excluded` set holds the UNCHECKED values (a row passes when its value is
 * NOT excluded), so an empty set = everything shown. The dropdown renders in a
 * portal with fixed positioning, so it is never clipped by the table's overflow.
 * Reusable across every data table.
 */
export function FilterHeader<F extends string>({
  label,
  field,
  active,
  dir,
  setSort,
  align = "left",
  width,
  className = "",
  options,
  excluded,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  label: string;
  field: F;
  /** Currently-active sort field. */
  active: F;
  dir: SortDir;
  setSort: (f: F, dir: SortDir) => void;
  align?: "left" | "right";
  width?: string;
  className?: string;
  /** Distinct values for the value filter. Omit for a sort-only column. */
  options?: FilterOption[];
  /** Unchecked values (a row passes when its value is not here). */
  excluded?: Set<string>;
  onToggle?: (value: string) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const isActiveSort = active === field;
  const hasFilter = !!options;
  const filterActive = !!excluded && excluded.size > 0;

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    let left = align === "right" ? b.right - POP_WIDTH : b.left;
    left = Math.max(8, Math.min(left, window.innerWidth - POP_WIDTH - 8));
    setPos({ top: Math.round(b.bottom + 4), left: Math.round(left) });
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  const shown = (options ?? []).filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={`px-2 py-2.5 v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Ordenar/filtrar ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.15em] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActiveSort || filterActive ? "text-[var(--accent)]" : "text-[var(--faint)]"}`}
      >
        <span>{label}</span>
        <span aria-hidden className="text-[9px] leading-none">
          {isActiveSort ? (dir === "asc" ? "↑" : "↓") : "▾"}
        </span>
        {filterActive && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: POP_WIDTH }}
            className="z-[70] rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-left normal-case tracking-normal shadow-[var(--shadow)]"
          >
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => { setSort(field, "asc"); setOpen(false); }}
                className={`rounded px-2 py-1 text-left text-xs transition hover:bg-[var(--surface-2)] ${
                  isActiveSort && dir === "asc" ? "font-semibold text-[var(--accent)]" : "text-[var(--ink)]"
                }`}
              >
                ↑ Ordenar (crescente)
              </button>
              <button
                type="button"
                onClick={() => { setSort(field, "desc"); setOpen(false); }}
                className={`rounded px-2 py-1 text-left text-xs transition hover:bg-[var(--surface-2)] ${
                  isActiveSort && dir === "desc" ? "font-semibold text-[var(--accent)]" : "text-[var(--ink)]"
                }`}
              >
                ↓ Ordenar (decrescente)
              </button>
            </div>

            {hasFilter && (
              <>
                <div className="my-1.5 border-t border-[var(--line)]" />
                <div className="mb-1 flex items-center justify-between px-1 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={onSelectAll} className="font-semibold text-[var(--accent)] hover:underline">
                      Selecionar todos ({options!.length})
                    </button>
                    <span className="text-[var(--faint)]">·</span>
                    <button type="button" onClick={onClearAll} className="font-semibold text-[var(--accent)] hover:underline">
                      Limpar
                    </button>
                  </div>
                  <span className="v-tabular text-[10px] text-[var(--faint)]">Exibindo {shown.length}</span>
                </div>
                <div className="relative mb-1">
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar…"
                    aria-label={`Buscar valores de ${label}`}
                    className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1 pr-6 text-xs text-[var(--ink)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
                  />
                  <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--faint)]">⌕</span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {shown.length === 0 ? (
                    <p className="px-1.5 py-2 text-xs text-[var(--faint)]">Nenhum valor.</p>
                  ) : (
                    shown.map((o) => {
                      const checked = !excluded?.has(o.value);
                      return (
                        <label
                          key={o.value}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--surface-2)]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle?.(o.value)}
                            className="h-3.5 w-3.5 accent-[var(--accent)]"
                          />
                          <span
                            className={`min-w-0 flex-1 truncate ${o.value === "" ? "italic text-[var(--muted)]" : "text-[var(--ink)]"}`}
                            title={o.label}
                          >
                            {o.value === "" ? "(Vazias)" : o.label}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </th>
  );
}
