import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { FxToggle } from "@/components/fx-toggle";
import { NavTabs } from "@/components/nav-tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSessionContext } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const canFinance = ctx.roles.includes("finance") || ctx.roles.includes("admin");
  const canFiscal = ctx.roles.includes("fiscal");
  const isAdmin = ctx.email.toLowerCase() === "gabriel.beltrami@vammo.com";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3px)] w-full max-w-[110rem] flex-col px-5 sm:px-8 lg:w-3/4">
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
          <FxToggle />
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
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                title="Sair"
                aria-label="Sair"
                className="text-[var(--faint)] transition hover:text-[var(--rejected)]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </header>

      <NavTabs isHead={ctx.isHead} canFinance={canFinance} canFiscal={canFiscal} isAdmin={isAdmin} />

      <main className="flex-1 pb-20 pt-8">{children}</main>

      <footer className="border-t border-[var(--line)] py-5 text-center v-tabular text-[10px] uppercase tracking-[0.25em] text-[var(--faint)]">
        goBuy — plataforma de compras Vammo
      </footer>
    </div>
  );
}
