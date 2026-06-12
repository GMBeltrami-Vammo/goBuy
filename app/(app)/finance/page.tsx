import { redirect } from "next/navigation";

import { FinanceDashboard } from "@/components/finance-dashboard";
import { getSessionContext } from "@/lib/auth";

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const { r } = await searchParams;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const canFinance = ctx.roles.includes("finance") || ctx.roles.includes("admin");
  const canFiscal = ctx.roles.includes("fiscal");
  if (!canFinance && !canFiscal) redirect("/");

  return (
    <FinanceDashboard
      email={ctx.email}
      canMarkPaid={canFinance}
      supabaseToken={ctx.supabaseToken}
      autoOpenDisplayId={r}
    />
  );
}
