import { redirect } from "next/navigation";

import { ChargesDashboard } from "@/components/charges-dashboard";
import { getSessionContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Cobranças — goBuy" };

export default async function CobrancasPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // Heads, full-app admins, and the RH approver may see the demo; nobody else.
  if (!ctx.isHead && !ctx.isFullAppAdmin && !ctx.isRhViewer) redirect("/");

  // All active cost centers — used to propose a target CC when reclassifying.
  const { data: allCostCenters } = await supabaseAdmin()
    .from("cost_centers")
    .select("id, code, name, department")
    .eq("active", true)
    .order("department")
    .order("code");

  return (
    <ChargesDashboard
      email={ctx.email}
      supabaseToken={ctx.supabaseToken}
      centerIds={ctx.headCenterIds}
      allCostCenters={allCostCenters ?? []}
      isRhViewer={ctx.isRhViewer}
    />
  );
}
