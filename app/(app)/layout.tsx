import { redirect } from "next/navigation";

import { NavTabs } from "@/components/nav-tabs";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ensureProfile, getSessionContext } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // Best-effort: keeps finance.user_profiles in sync on every visit.
  await ensureProfile(ctx);

  const canFinance = ctx.roles.includes("finance") || ctx.roles.includes("admin");
  const canFiscal = ctx.roles.includes("fiscal");

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3px)] w-full max-w-5xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between gap-4 pb-2 pt-6">
        <div className="flex items-baseline gap-3">
          <span className="text-xl font-bold tracking-tight">
            go<span className="text-[var(--accent)]">Buy</span>
          </span>
          <span className="hidden v-tabular text-[10px] uppercase tracking-[0.3em] text-[var(--faint)] sm:block">
            Vammo · Compras
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <div className="flex items-center gap-2 rounded-full border border-[var(--line)] py-1 pl-1 pr-3">
            {ctx.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ctx.avatarUrl}
                alt=""
                className="h-7 w-7 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent)]">
                {ctx.fullName.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="hidden max-w-[140px] truncate text-xs font-medium sm:block">
              {ctx.fullName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <NavTabs isHead={ctx.isHead} canFinance={canFinance} canFiscal={canFiscal} />

      <main className="flex-1 pb-20 pt-8">{children}</main>

      <footer className="border-t border-[var(--line)] py-5 text-center v-tabular text-[10px] uppercase tracking-[0.25em] text-[var(--faint)]">
        goBuy — plataforma de compras Vammo
      </footer>
    </div>
  );
}
