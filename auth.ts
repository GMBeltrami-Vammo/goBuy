import { SignJWT } from "jose";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Derives a deterministic UUID from an email using SHA-256 (Web Crypto — Edge safe).
 * Supabase's auth.uid() casts the JWT sub to uuid; we need a valid UUID format.
 * Our RLS uses auth.email(), but having a valid sub avoids Postgres cast errors.
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

async function mintSupabaseToken(email: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
  return new SignJWT({
    role: "authenticated",
    email,
    sub: await emailToSub(email),
    aud: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  pages: { signIn: "/login", error: "/login" },

  callbacks: {
    // Only @vammo.com Google accounts may sign in.
    signIn({ user }) {
      return user.email?.toLowerCase().endsWith("@vammo.com") ?? false;
    },

    // Store a Supabase-compatible JWT in the NextAuth token so client
    // components can make authenticated Supabase queries under RLS.
    async jwt({ token, user }) {
      if (user?.email) {
        token.supabaseToken = await mintSupabaseToken(user.email);
        token.supabaseTokenAt = Date.now();
      }
      // Refresh the Supabase token before it expires (token lifetime is 8h).
      if (
        token.email &&
        token.supabaseToken &&
        token.supabaseTokenAt &&
        Date.now() - (token.supabaseTokenAt as number) > 7 * 3600 * 1000
      ) {
        token.supabaseToken = await mintSupabaseToken(token.email as string);
        token.supabaseTokenAt = Date.now();
      }
      return token;
    },

    session({ session, token }) {
      return { ...session, supabaseToken: token.supabaseToken as string };
    },

    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
});
