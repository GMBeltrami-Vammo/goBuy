export function NoAccess({ firstName }: { firstName?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Sem acesso</h1>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        {firstName ? `Olá, ${firstName}. ` : ""}
        Sua conta ainda não é responsável por um centro de custo nem tem acesso administrativo.
        Fale com o time de Finanças para liberar seu acesso.
      </p>
    </div>
  );
}
