import { redirect } from "next/navigation";

import { RequestsDashboard } from "@/components/requests-dashboard";
import { getSessionContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function HomePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const { data: costCenters } = await supabaseAdmin()
    .from("cost_centers")
    .select("id, code, name, department, active")
    .eq("active", true)
    .order("department")
    .order("code");

  return (
    <RequestsDashboard
      email={ctx.email}
      firstName={ctx.fullName.split(" ")[0]}
      supabaseToken={ctx.supabaseToken}
      initialCostCenters={costCenters ?? []}
    />
  );
}
