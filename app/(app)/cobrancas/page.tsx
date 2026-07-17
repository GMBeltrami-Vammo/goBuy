import { redirect } from "next/navigation";

import { ChargesDashboard } from "@/components/charges-dashboard";
import { getSessionContext } from "@/lib/auth";

export const metadata = { title: "Cobranças — goBuy" };

export default async function CobrancasPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // Heads and full-app admins may see the demo; nobody else.
  if (!ctx.isHead && !ctx.isFullAppAdmin) redirect("/");

  return (
    <ChargesDashboard
      email={ctx.email}
      supabaseToken={ctx.supabaseToken}
      centerIds={ctx.headCenterIds}
    />
  );
}
