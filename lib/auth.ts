import { cache } from "react";

import { auth } from "@/auth";
import { RH_VIEWER_EMAIL } from "@/lib/rh-viewer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AppRole, SessionContext } from "@/lib/types";

export const VAMMO_DOMAIN = "@vammo.com";

export const isVammoEmail = (email: string | undefined | null): email is string =>
  !!email && email.toLowerCase().endsWith(VAMMO_DOMAIN);

// Server-only allowlist of emails that may see the full (non-demo) app, on top
// of anyone holding the `admin` role (see isFullAppAdmin below). Everyone else
// who is a cost-center head sees only the /cobrancas approval demo.
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

  const [headRes, rolesRes, delRes] = await Promise.all([
    // Only active cost centers — deactivated ones must not surface to the head.
    admin
      .from("cost_center_heads")
      .select("cost_center_id, cost_centers!inner(active)")
      .eq("head_email", email)
      .eq("cost_centers.active", true),
    admin.from("user_roles").select("role").eq("user_email", email),
    // Cost centers this user is an active substitute (férias) for. Defensive:
    // returns {data:null} (handled as []) if the RPC isn't deployed yet.
    admin.rpc("delegated_center_ids", { p_email: email }),
  ]);

  const isRhViewer = email === RH_VIEWER_EMAIL;
  const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
  const isAdmin = roles.includes("admin");
  // The RH approver is a confidential RH-only viewer, never a normal CC head —
  // even if seeded as head of the HR CCs — so they never see non-RH charges or
  // budgets (RLS enforces the same). Empty their head centers here.
  const ownHeadCenterIds = isRhViewer ? [] : (headRes.data ?? []).map((r) => r.cost_center_id as number);
  // Active delegations grant the substitute the delegator's CCs for the window.
  const delegatedCenterIds = isRhViewer
    ? []
    : ((delRes.data ?? []) as { cost_center_id: number }[]).map((r) => r.cost_center_id);

  // What the user answers for. Admins are head of EVERY active cost center
  // (superuser) — computed, so no explicit cost_center_heads rows are needed.
  // Everyone else: their own head CCs ∪ any they're an active substitute for.
  // The RH approver stays RH-only (empty).
  let headCenterIds: number[];
  if (isRhViewer) {
    headCenterIds = [];
  } else if (isAdmin) {
    const { data: allCcs } = await admin.from("cost_centers").select("id").eq("active", true);
    headCenterIds = (allCcs ?? []).map((r) => r.id as number);
  } else {
    headCenterIds = [...new Set([...ownHeadCenterIds, ...delegatedCenterIds])];
  }

  return {
    email,
    fullName: session.user.name ?? email.split("@")[0],
    avatarUrl: session.user.image ?? null,
    isHead: headCenterIds.length > 0,
    headCenterIds,
    // Heads (explicit) and admins see the delegate button. For an admin the flow
    // is identical but hands off nothing — an admin holds no explicit
    // cost_center_heads rows, so is_delegate_of() grants the substitute no CC
    // (visually indistinguishable, zero effect). RH viewer never delegates.
    canDelegate: !isRhViewer && (isAdmin || ownHeadCenterIds.length > 0),
    roles,
    // The `admin` role always grants full-app access; the env allowlist is an
    // extra escape hatch for non-admin full-app users. One source of truth for
    // "admin" — no separate list to keep in sync.
    isFullAppAdmin: FULL_APP_ADMINS.includes(email) || roles.includes("admin"),
    isReclassifier: roles.includes("reclassifier"),
    isRhViewer,
    supabaseToken: session.supabaseToken ?? "",  // "" → unauthenticated Supabase client; RLS blocks all reads
  };
});
