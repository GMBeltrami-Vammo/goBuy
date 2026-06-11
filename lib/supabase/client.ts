import { createClient } from "@supabase/supabase-js";

/**
 * Returns an authenticated Supabase client scoped to the finance schema.
 * Pass the Supabase token from the NextAuth session — it is a signed JWT that
 * activates RLS (auth.email() / auth.uid()) exactly like a real Supabase session.
 * Safe to call from both client components and server API routes.
 */
export function supabaseBrowser(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "finance" },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    },
  );
}
