"use client";

import { useState } from "react";

/** Canonical page size for every request list in the app. */
export const PAGE_SIZE = 20;

/**
 * Client-side pagination over an already-filtered list. Pass a `resetKey`
 * built from the active filters so changing a filter jumps back to page 1.
 * The returned `page` is always clamped to the valid range, so a shrinking
 * list never leaves the view stranded on an empty page.
 */
export function usePagination<T>(items: T[], resetKey = "", pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  // Reset to page 1 when the filter signature changes — the "adjust state
  // during render" pattern, avoiding a post-render effect.
  const [prevKey, setPrevKey] = useState(resetKey);
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    page: current,
    setPage,
    pageCount,
    pageItems,
    total: items.length,
    start,
    end: start + pageItems.length,
    pageSize,
  };
}

export function Pagination({
  page,
  pageCount,
  onPage,
  total,
  start,
  end,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  total: number;
  start: number;
  end: number;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
      <span className="v-tabular text-[11px] text-[var(--faint)]">
        {start + 1}–{end} de {total}
      </span>
      <div className="flex items-center gap-1">
        <PagerButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Página anterior">
          ‹
        </PagerButton>
        <span className="v-tabular px-2 text-[11px] text-[var(--muted)]">
          {page} / {pageCount}
        </span>
        <PagerButton disabled={page >= pageCount} onClick={() => onPage(page + 1)} label="Próxima página">
          ›
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-strong)] text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-30 disabled:hover:border-[var(--line-strong)] disabled:hover:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {children}
    </button>
  );
}
