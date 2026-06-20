import { redirect } from "next/navigation";

import { AdminDashboard } from "@/components/admin-dashboard";
import { getSessionContext } from "@/lib/auth";

const SUPER_ADMIN = "gabriel.beltrami@vammo.com";

export const metadata = { title: "Admin — Lumen" };

export default async function AdminPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.email.toLowerCase() !== SUPER_ADMIN) redirect("/");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)]">Administração</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Gerencie acessos, roles e centros de custo do Lumen.
        </p>
      </div>
      <AdminDashboard />
    </div>
  );
}
