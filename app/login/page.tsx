import { GoogleSignIn } from "@/components/google-sign-in";

const ERRORS: Record<string, string> = {
  domain: "Apenas contas @vammo.com têm acesso. Entre com seu e-mail corporativo.",
  auth: "Não foi possível autenticar. Tente novamente.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-[calc(100vh-3px)] items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="reveal reveal-1 mb-10 text-center">
          <p className="v-tabular text-xs uppercase tracking-[0.35em] text-[var(--faint)]">
            Vammo · Financeiro
          </p>
          <h1 className="mt-3 text-5xl font-bold tracking-tight">
            go<span className="text-[var(--accent)]">Buy</span>
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Solicitações de compra, aprovações e pagamentos — em um só lugar.
          </p>
        </div>

        <div className="reveal reveal-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow)]">
          {error && ERRORS[error] && (
            <p className="mb-4 rounded-lg border border-[var(--rejected)] bg-[var(--rejected-soft)] px-3 py-2 text-sm text-[var(--rejected)]">
              {ERRORS[error]}
            </p>
          )}
          <GoogleSignIn />
          <p className="mt-4 text-center text-xs text-[var(--faint)]">
            Acesso restrito a contas <span className="font-medium">@vammo.com</span>
          </p>
        </div>

        <p className="reveal reveal-3 mt-8 text-center v-tabular text-[11px] text-[var(--faint)]">
          goBuy v1 — plataforma interna de compras
        </p>
      </div>
    </main>
  );
}
