import { SignJWT } from "jose";

/**
 * Derives a deterministic UUID from an email using SHA-256 (Web Crypto).
 * Supabase's auth.uid() casts the JWT sub to uuid; a valid UUID avoids cast
 * errors. RLS itself keys off auth.email(), not the sub.
 */
async function emailToSub(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  const h = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${
    ((parseInt(h[16], 16) & 3) | 8).toString(16)
  }${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Mints a short-lived Supabase-compatible HS256 JWT for an email so server
 * code can call finance RPCs *as that user*, with RLS and the RPC's own
 * is_head_of()/is_vammo_user() checks enforced by Postgres. This is the single
 * source of truth for "act as user" — the web path (NextAuth) and the Slack
 * interaction path both mint identical tokens.
 */
export async function mintSupabaseToken(email: string, ttl = "8h"): Promise<string> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET not configured");
  return new SignJWT({
    role: "authenticated",
    email,
    sub: await emailToSub(email),
    aud: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}
