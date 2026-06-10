import { cache } from "react";

import { supabaseServer } from "@/lib/supabase/server";
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
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isVammoEmail(user.email)) return null;
  const email = user.email.toLowerCase();

  const [headRes, rolesRes] = await Promise.all([
    supabase.from("cost_center_heads").select("cost_center_id").eq("head_email", email),
    supabase.from("user_roles").select("role").eq("user_email", email),
  ]);

  const headCenterIds = (headRes.data ?? []).map((r) => r.cost_center_id as number);
  const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);

  return {
    userId: user.id,
    email,
    fullName:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      email.split("@")[0],
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    isHead: headCenterIds.length > 0,
    headCenterIds,
    roles,
  };
});

/** Best-effort profile upsert on login (RLS allows only the self row). */
export async function ensureProfile(ctx: SessionContext) {
  const supabase = await supabaseServer();
  await supabase.from("user_profiles").upsert(
    {
      user_id: ctx.userId,
      email: ctx.email,
      full_name: ctx.fullName,
      avatar_url: ctx.avatarUrl,
    },
    { onConflict: "user_id" },
  );
}
