import { cache } from "react";

import { auth } from "@/auth";
import { RH_VIEWER_EMAIL } from "@/lib/rh-viewer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AppRole, SessionContext } from "@/lib/types";

export const VAMMO_DOMAIN = "@vammo.com";

export const isVammoEmail = (email: string | undefined | null): email is string =>
  !!email && email.toLowerCase().endsWith(VAMMO_DOMAIN);

// Server-only allowlist of emails that may see the full (non-demo) app. Everyone
// else who is a cost-center head sees only the /cobrancas approval demo.
const FULL_APP_ADMINS = (process.env.FULL_APP_ADMINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Resolves the signed-in user's capabilities (head centers + roles).
 * Returns null when there is no valid @vammo.com session.
 * Cached per request (React.cache) so layout + pages share one lookup.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const session = await auth();
  if (!session?.user?.email || !isVammoEmail(session.user.email)) return null;

  const email = session.user.email.toLowerCase();
  const admin = supabaseAdmin();

  const [headRes, rolesRes] = await Promise.all([
    // Only active cost centers — deactivated ones must not surface to the head.
    admin
      .from("cost_center_heads")
      .select("cost_center_id, cost_centers!inner(active)")
      .eq("head_email", email)
      .eq("cost_centers.active", true),
    admin.from("user_roles").select("role").eq("user_email", email),
  ]);

  const isRhViewer = email === RH_VIEWER_EMAIL;
  const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
  // The RH approver is a confidential RH-only viewer, never a normal CC head —
  // even if seeded as head of the HR CCs — so they never see non-RH charges or
  // budgets (RLS enforces the same). Empty their head centers here.
  const headCenterIds = isRhViewer ? [] : (headRes.data ?? []).map((r) => r.cost_center_id as number);

  return {
    email,
    fullName: session.user.name ?? email.split("@")[0],
    avatarUrl: session.user.image ?? null,
    isHead: headCenterIds.length > 0,
    headCenterIds,
    roles,
    isFullAppAdmin: FULL_APP_ADMINS.includes(email),
    isReclassifier: roles.includes("reclassifier"),
    isRhViewer,
    supabaseToken: session.supabaseToken ?? "",  // "" → unauthenticated Supabase client; RLS blocks all reads
  };
});
