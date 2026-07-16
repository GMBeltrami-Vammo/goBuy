import { redirect } from "next/navigation";

import { NoAccess } from "@/components/no-access";
import { RequestsDashboard } from "@/components/requests-dashboard";
import { getSessionContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // Non-admins never see the full app. Heads go to the demo; everyone else
  // (no head centers, not an admin) gets a friendly no-access screen.
  if (!ctx.isFullAppAdmin) {
    if (ctx.isHead) redirect("/cobrancas");
    return <NoAccess firstName={ctx.fullName.split(" ")[0]} />;
  }

  const { r } = await searchParams;

  const { data: costCenters } = await supabaseAdmin()
    .from("cost_centers")
    .select("id, code, name, department, active, cost_center_heads(head_name, head_email)")
    .eq("active", true)
    .order("department")
    .order("code");

  return (
    <RequestsDashboard
      email={ctx.email}
      firstName={ctx.fullName.split(" ")[0]}
      supabaseToken={ctx.supabaseToken}
      initialCostCenters={costCenters ?? []}
      autoOpenDisplayId={r}
    />
  );
}
