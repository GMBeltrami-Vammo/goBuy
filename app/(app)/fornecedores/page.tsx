import { redirect } from "next/navigation";

import { FornecedoresDashboard } from "@/components/fornecedores-dashboard";
import { getSessionContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Fornecedores — goBuy" };

export default async function FornecedoresPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.isFullAppAdmin) redirect("/cobrancas");

  const canFinance = ctx.roles.includes("finance") || ctx.roles.includes("admin");
  if (!canFinance) redirect("/");

  const { data: costCenters } = await supabaseAdmin()
    .from("cost_centers")
    .select("id, code, name, department, active")
    .eq("active", true)
    .order("department")
    .order("code");

  return (
    <FornecedoresDashboard
      supabaseToken={ctx.supabaseToken}
      costCenters={costCenters ?? []}
    />
  );
}
