import { redirect } from "next/navigation";

import { RequestsDashboard } from "@/components/requests-dashboard";
import { getSessionContext } from "@/lib/auth";

export default async function HomePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  return (
    <RequestsDashboard
      email={ctx.email}
      firstName={ctx.fullName.split(" ")[0]}
      supabaseToken={ctx.supabaseToken}
    />
  );
}
