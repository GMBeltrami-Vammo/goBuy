import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { mintSupabaseToken } from "@/lib/supabase/token";

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
