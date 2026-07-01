import { signIn } from "@/auth";

const ERRORS: Record<string, string> = {
  OAuthSignin: "Não foi possível iniciar o login. Tente novamente.",
  OAuthCallback: "Erro no retorno do Google. Tente novamente.",
  OAuthAccountNotLinked: "Apenas contas @vammo.com têm acesso.",
  AccessDenied: "Apenas contas @vammo.com têm acesso. Entre com seu e-mail corporativo.",
  Default: "Não foi possível autenticar. Tente novamente.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMsg = error ? (ERRORS[error] ?? ERRORS.Default) : null;

  return (
    <main className="flex min-h-[calc(100vh-3px)] items-center justify-center px-5 sm:px-8">
      <div className="w-full max-w-sm">
        <div className="reveal reveal-1 mb-10 text-center">
          <p className="v-tabular text-xs uppercase tracking-[0.35em] text-[var(--faint)]">
            Vammo · Financeiro
          </p>
          <h1 className="mt-3 text-5xl font-bold tracking-tight">
            <span className="text-[var(--accent)]">Lu</span>men
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Solicitações de compra, aprovações e pagamentos — em um só lugar.
          </p>
        </div>

        <div className="reveal reveal-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow)]">
          {errorMsg && (
            <p className="mb-4 rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-3 py-2 text-sm text-[var(--rejected)]">
              {errorMsg}
            </p>
          )}
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm font-medium transition hover:border-[var(--accent)] hover:bg-[var(--surface-2)]"
            >
              <GoogleIcon />
              Entrar com Google
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-[var(--faint)]">
            Acesso restrito a contas <span className="font-medium">@vammo.com</span>
          </p>
        </div>

        <p className="reveal reveal-3 mt-8 text-center v-tabular text-[11px] text-[var(--faint)]">
          Lumen v1 — plataforma interna de compras
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
