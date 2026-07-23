"use client";

import { useState } from "react";

export type SortDir = "asc" | "desc";

/**
 * Sort state + a header click handler, reusable across the data tables. Clicking
 * the active column flips asc↔desc; clicking a new column switches to it (asc).
 */
export function useSort<F extends string>(initialField: F, initialDir: SortDir = "asc") {
  const [field, setField] = useState<F>(initialField);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const onSort = (f: F) => {
    if (f === field) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setField(f);
      setDir("asc");
    }
  };
  const setSort = (f: F, d: SortDir) => {
    setField(f);
    setDir(d);
  };
  const reset = () => {
    setField(initialField);
    setDir(initialDir);
  };
  return { field, dir, onSort, setSort, reset };
}

/**
 * A clickable, sortable column header ("spreadsheet" style): shows ↑/↓ on the
 * active column and ↕ otherwise. Lives in the table's own header so there is no
 * popover to be clipped by overflow containers.
 */
export function SortHeader<F extends string>({
  label,
  field,
  active,
  dir,
  onSort,
  align = "left",
  width,
  className = "",
}: {
  label: string;
  field: F;
  /** The currently-active sort field. */
  active: F;
  dir: SortDir;
  onSort: (f: F) => void;
  align?: "left" | "right";
  width?: string;
  className?: string;
}) {
  const isActive = active === field;
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={`px-2 py-2.5 v-tabular text-[10px] font-semibold uppercase tracking-[0.15em] ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={`Ordenar por ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.15em] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[var(--accent)]" : "text-[var(--faint)]"}`}
      >
        <span>{label}</span>
        <span aria-hidden className="text-[9px] leading-none">
          {isActive ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
