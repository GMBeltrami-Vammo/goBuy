"use client";

import { useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";

export function GoogleSignIn() {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    const supabase = supabaseBrowser();
    const origin =
      typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback`,
        queryParams: { hd: "vammo.com", prompt: "select_account" },
      },
    });
  };

  return (
    <button
      onClick={signIn}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-60"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#4285F4"
          d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.29v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l4-3.1z"
        />
        <path
          fill="#EA4335"
          d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.1C6.23 6.88 8.88 4.77 12 4.77z"
        />
      </svg>
      {loading ? "Redirecionando…" : "Entrar com Google"}
    </button>
  );
}
