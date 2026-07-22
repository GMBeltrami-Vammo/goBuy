import { redirect } from "next/navigation";

import { ReclassDashboard } from "@/components/reclass-dashboard";
import { getSessionContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Reclassificações — goBuy" };

export default async function ReclassificacoesPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // Reclassifiers (Bruna/Maria) and full-app admins only.
  if (!ctx.isReclassifier && !ctx.isFullAppAdmin) redirect("/");

  const { data: allCostCenters } = await supabaseAdmin()
    .from("cost_centers")
    .select("id, code, name, department")
    .eq("active", true)
    .order("department")
    .order("code");

  return <ReclassDashboard supabaseToken={ctx.supabaseToken} allCostCenters={allCostCenters ?? []} />;
}
