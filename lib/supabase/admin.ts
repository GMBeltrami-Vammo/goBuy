import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS — use ONLY in API routes after the
 * caller's session and authorization have been verified with the
 * user-scoped client. Never import from client components.
 */
export function supabaseAdmin() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY not configured");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
    db: { schema: "finance" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const DOCUMENTS_BUCKET = "finance-documents";
