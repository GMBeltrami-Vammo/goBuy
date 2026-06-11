import { redirect } from "next/navigation";

import { HeadDashboard } from "@/components/head-dashboard";
import { getSessionContext } from "@/lib/auth";

export default async function ApprovalsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.isHead) redirect("/");

  return (
    <HeadDashboard
      email={ctx.email}
      centerIds={ctx.headCenterIds}
      supabaseToken={ctx.supabaseToken}
    />
  );
}
