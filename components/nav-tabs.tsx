"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavTabs({
  isHead,
  canFinance,
  canFiscal,
}: {
  isHead: boolean;
  canFinance: boolean;
  canFiscal: boolean;
}) {
  const pathname = usePathname();

  const tabs = [
    { href: "/", label: "Minhas solicitações" },
    ...(isHead ? [{ href: "/approvals", label: "Aprovações" }] : []),
    ...(canFinance || canFiscal ? [{ href: "/finance", label: "Financeiro" }] : []),
  ];

  return (
    <nav className="flex gap-1 border-b border-[var(--line)]">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition ${
              active
                ? "border-[var(--accent)] font-semibold text-[var(--ink)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
