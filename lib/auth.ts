import { cache } from "react";

import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AppRole, SessionContext } from "@/lib/types";

export const VAMMO_DOMAIN = "@vammo.com";

export const isVammoEmail = (email: string | undefined | null): email is string =>
  !!email && email.toLowerCase().endsWith(VAMMO_DOMAIN);

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

  const headCenterIds = (headRes.data ?? []).map((r) => r.cost_center_id as number);
  const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);

  return {
    email,
    fullName: session.user.name ?? email.split("@")[0],
    avatarUrl: session.user.image ?? null,
    isHead: headCenterIds.length > 0,
    headCenterIds,
    roles,
    supabaseToken: session.supabaseToken ?? "",  // "" → unauthenticated Supabase client; RLS blocks all reads
  };
});
