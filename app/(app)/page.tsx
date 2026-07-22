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

  // Non-admins never see the full app. Heads go to the charges demo,
  // reclassifiers to their queue; everyone else gets a friendly no-access screen.
  if (!ctx.isFullAppAdmin) {
    if (ctx.isHead) redirect("/cobrancas");
    if (ctx.isReclassifier) redirect("/reclassificacoes");
    return <NoAccess firstName={ctx.fullName.split(" ")[0]} />;
  }

  const { r } = await searchParams;

  const admin = supabaseAdmin();
  const [{ data: costCenters }, { data: fornecedores }] = await Promise.all([
    admin
      .from("cost_centers")
      .select("id, code, name, department, active, cost_center_heads(head_name, head_email)")
      .eq("active", true)
      .order("department")
      .order("code"),
    admin
      .from("fornecedores")
      .select("*")
      .eq("status", "approved")
      .eq("active", true)
      .order("razao_social"),
  ]);

  return (
    <RequestsDashboard
      email={ctx.email}
      firstName={ctx.fullName.split(" ")[0]}
      supabaseToken={ctx.supabaseToken}
      initialCostCenters={costCenters ?? []}
      initialFornecedores={fornecedores ?? []}
      autoOpenDisplayId={r}
    />
  );
}
