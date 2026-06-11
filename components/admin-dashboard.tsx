"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AppRole = "finance" | "fiscal" | "admin";

interface RoleRow {
  user_email: string;
  role: AppRole;
}
interface HeadRow {
  cost_center_id: number;
  head_email: string;
  head_name: string | null;
}
interface CostCenter {
  id: number;
  code: string;
  name: string;
  department: string;
}
interface AdminData {
  roles: RoleRow[];
  heads: HeadRow[];
  costCenters: CostCenter[];
}
interface RequestRow {
  id: string;
  display_id: string;
  status: string;
  requester_email: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  created_at: string;
  cost_centers?: { code: string; name: string; department: string };
}
interface UserSummary {
  email: string;
  roles: AppRole[];
  headCenters: { id: number; code: string; name: string }[];
}
interface ImportRow {
  code: string;
  name: string;
  department: string;
  head_email: string;
  head_name: string;
}

const ROLE_LABEL: Record<AppRole, string> = {
  finance: "Financeiro",
  fiscal: "Fiscal",
  admin: "Admin",
};
const ROLE_CHIP: Record<AppRole, string> = {
  finance:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  fiscal: "bg-[var(--accent-soft)] text-[var(--accent)]",
  admin: "bg-orange-100 text-orange-700",
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">
      {children}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
      {children}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
      {children}
    </th>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={10} className="px-4 py-10 text-center text-sm text-[var(--faint)]">
        {label}
      </td>
    </tr>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] " +
        (props.className ?? "")
      }
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
    />
  );
}

function Btn({
  children,
  variant = "primary",
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={
        variant === "primary"
          ? "rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          : "text-xs text-[var(--faint)] transition hover:text-[var(--rejected)] disabled:opacity-40"
      }
    >
      {children}
    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Search filters
  const [userSearch, setUserSearch] = useState("");
  const [headSearch, setHeadSearch] = useState("");

  // Add role form
  const [roleEmail, setRoleEmail] = useState("");
  const [roleRole, setRoleRole] = useState<AppRole>("fiscal");
  const [roleLoading, setRoleLoading] = useState(false);

  // Add head form
  const [headCC, setHeadCC] = useState("");
  const [headEmail, setHeadEmail] = useState("");
  const [headName, setHeadName] = useState("");
  const [headLoading, setHeadLoading] = useState(false);

  // Import
  const fileRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // Cleanup (test data)
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const flash = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/roles");
    if (!res.ok) return;
    setData((await res.json()) as AdminData);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Derive per-user summary (roles + head center list)
  const allUsers: UserSummary[] = (() => {
    if (!data) return [];
    const map = new Map<string, UserSummary>();
    const get = (email: string) => {
      if (!map.has(email))
        map.set(email, { email, roles: [], headCenters: [] });
      return map.get(email)!;
    };
    for (const r of data.roles) get(r.user_email).roles.push(r.role);
    for (const h of data.heads) {
      const cc = data.costCenters.find((c) => c.id === h.cost_center_id);
      if (cc) get(h.head_email).headCenters.push({ id: cc.id, code: cc.code, name: cc.name });
    }
    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  })();

  const filteredUsers = userSearch.trim()
    ? allUsers.filter((u) => u.email.includes(userSearch.toLowerCase()))
    : allUsers;

  const filteredHeads = (() => {
    if (!data) return [];
    const q = headSearch.toLowerCase().trim();
    return q
      ? data.heads.filter((h) => {
          const cc = data.costCenters.find((c) => c.id === h.cost_center_id);
          return (
            h.head_email.includes(q) ||
            (cc?.code.toLowerCase().includes(q) ?? false) ||
            (cc?.name.toLowerCase().includes(q) ?? false)
          );
        })
      : data.heads;
  })();

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const addRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleLoading(true);
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: roleEmail, role: roleRole }),
    });
    setRoleLoading(false);
    if (res.ok) {
      flash(`Role ${ROLE_LABEL[roleRole]} adicionada para ${roleEmail}`);
      setRoleEmail("");
      void reload();
    } else {
      const err = (await res.json()) as { error?: string };
      flash(err.error ?? "Erro ao adicionar role", false);
    }
  };

  const removeRole = async (email: string, role: AppRole) => {
    const res = await fetch("/api/admin/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      flash(`Role ${ROLE_LABEL[role]} removida de ${email}`);
      void reload();
    } else {
      flash("Erro ao remover role", false);
    }
  };

  const addHead = async (e: React.FormEvent) => {
    e.preventDefault();
    setHeadLoading(true);
    const cc = data?.costCenters.find((c) => c.id === Number(headCC));
    const res = await fetch("/api/admin/heads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cost_center_id: Number(headCC),
        head_email: headEmail,
        head_name: headName,
      }),
    });
    setHeadLoading(false);
    if (res.ok) {
      flash(`Responsável adicionado ao centro ${cc?.code ?? headCC}`);
      setHeadEmail("");
      setHeadName("");
      setHeadCC("");
      void reload();
    } else {
      const err = (await res.json()) as { error?: string };
      flash(err.error ?? "Erro ao adicionar responsável", false);
    }
  };

  const removeHead = async (costCenterId: number, email: string) => {
    const res = await fetch("/api/admin/heads", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cost_center_id: costCenterId, head_email: email }),
    });
    if (res.ok) {
      flash("Responsável removido");
      void reload();
    } else {
      flash("Erro ao remover responsável", false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setPreview(null);
    setPreviewLoading(true);

    const form = new FormData();
    form.append("file", file);
    form.append("action", "preview");

    const res = await fetch("/api/admin/import", { method: "POST", body: form });
    setPreviewLoading(false);

    if (res.ok) {
      const { rows } = (await res.json()) as { rows: ImportRow[] };
      setPreview(rows);
    } else {
      const err = (await res.json()) as { error?: string };
      flash(err.error ?? "Erro ao ler arquivo", false);
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    if (!importFile) return;
    setImportLoading(true);

    const form = new FormData();
    form.append("file", importFile);
    form.append("action", "confirm");

    const res = await fetch("/api/admin/import", { method: "POST", body: form });
    setImportLoading(false);

    if (res.ok) {
      const { imported, heads_linked } = (await res.json()) as {
        imported: number;
        heads_linked: number;
      };
      flash(
        `${imported} centro(s) importado(s), ${heads_linked} responsável(eis) vinculado(s)`,
      );
      setPreview(null);
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void reload();
    } else {
      const err = (await res.json()) as { error?: string };
      flash(err.error ?? "Erro ao importar", false);
    }
  };

  const loadRequests = async () => {
    setRequestsLoading(true);
    const res = await fetch("/api/admin/cleanup");
    setRequestsLoading(false);
    if (res.ok) {
      const { requests: data } = (await res.json()) as { requests: RequestRow[] };
      setRequests(data);
    } else {
      flash("Erro ao carregar solicitações", false);
    }
  };

  const deleteRequest = async (id: string, displayId: string) => {
    if (!confirm(`Excluir permanentemente ${displayId}? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(id);
    const res = await fetch("/api/admin/cleanup", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    if (res.ok) {
      flash(`${displayId} excluída`);
      setRequests((prev) => prev?.filter((r) => r.id !== id) ?? null);
    } else {
      const err = (await res.json()) as { error?: string };
      flash(err.error ?? "Erro ao excluir", false);
    }
  };

  const STATUS_PT: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Rejeitada",
    cancelled: "Cancelada",
    paid: "Paga",
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-[var(--muted)]">Carregando...</span>
      </div>
    );
  }

  const costCenters = data?.costCenters ?? [];

  return (
    <div className="space-y-12">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Section 1: Roles ─────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Roles de usuários</SectionTitle>
        <Card>
          {/* Search */}
          <div className="border-b border-[var(--line)] px-4 py-3">
            <Input
              type="search"
              placeholder="Filtrar por e-mail..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="w-72"
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <Th>E-mail</Th>
                  <Th>Roles</Th>
                  <Th>Centros (aprovador)</Th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <Empty label="Nenhum usuário encontrado." />
                ) : (
                  filteredUsers.map((u) => (
                    <tr
                      key={u.email}
                      className="border-b border-[var(--line)] last:border-0"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-[var(--ink)]">
                        {u.email}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {u.roles.length === 0 ? (
                            <span className="text-xs text-[var(--faint)]">—</span>
                          ) : (
                            u.roles.map((role) => (
                              <span
                                key={role}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_CHIP[role]}`}
                              >
                                {ROLE_LABEL[role]}
                                <button
                                  onClick={() => void removeRole(u.email, role)}
                                  title={`Remover ${ROLE_LABEL[role]}`}
                                  className="opacity-50 transition hover:opacity-100"
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.headCenters.length === 0 ? (
                            <span className="text-xs text-[var(--faint)]">—</span>
                          ) : (
                            u.headCenters.map((cc) => (
                              <span
                                key={cc.id}
                                title={cc.name}
                                className="rounded bg-[var(--line)] px-1.5 py-0.5 font-mono text-xs"
                              >
                                {cc.code}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Add role form */}
          <form
            onSubmit={(e) => void addRole(e)}
            className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-3"
          >
            <Input
              type="email"
              placeholder="nome@vammo.com"
              value={roleEmail}
              onChange={(e) => setRoleEmail(e.target.value)}
              required
              className="w-64"
            />
            <Select
              value={roleRole}
              onChange={(e) => setRoleRole(e.target.value as AppRole)}
            >
              <option value="fiscal">Fiscal</option>
              <option value="finance">Financeiro</option>
              <option value="admin">Admin</option>
            </Select>
            <Btn type="submit" variant="primary" disabled={roleLoading}>
              {roleLoading ? "Adicionando..." : "Adicionar role"}
            </Btn>
          </form>
        </Card>
      </section>

      {/* ── Section 2: Heads ─────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Responsáveis por centro de custo</SectionTitle>
        <Card>
          {/* Search */}
          <div className="border-b border-[var(--line)] px-4 py-3">
            <Input
              type="search"
              placeholder="Filtrar por código, nome ou e-mail..."
              value={headSearch}
              onChange={(e) => setHeadSearch(e.target.value)}
              className="w-80"
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <Th>Centro de custo</Th>
                  <Th>E-mail responsável</Th>
                  <Th>Nome</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filteredHeads.length === 0 ? (
                  <Empty label="Nenhum responsável cadastrado." />
                ) : (
                  filteredHeads.map((h) => {
                    const cc = costCenters.find((c) => c.id === h.cost_center_id);
                    return (
                      <tr
                        key={`${h.cost_center_id}-${h.head_email}`}
                        className="border-b border-[var(--line)] last:border-0"
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                            {cc?.code ?? "?"}
                          </span>
                          {cc && (
                            <span className="ml-2 text-[var(--muted)]">{cc.name}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{h.head_email}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {h.head_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Btn
                            variant="ghost"
                            onClick={() => void removeHead(h.cost_center_id, h.head_email)}
                          >
                            Remover
                          </Btn>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Add head form */}
          <form
            onSubmit={(e) => void addHead(e)}
            className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-3"
          >
            <Select
              value={headCC}
              onChange={(e) => setHeadCC(e.target.value)}
              required
            >
              <option value="">Centro de custo...</option>
              {costCenters.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} — {cc.name}
                </option>
              ))}
            </Select>
            <Input
              type="email"
              placeholder="email@vammo.com"
              value={headEmail}
              onChange={(e) => setHeadEmail(e.target.value)}
              required
              className="w-56"
            />
            <Input
              type="text"
              placeholder="Nome (opcional)"
              value={headName}
              onChange={(e) => setHeadName(e.target.value)}
              className="w-40"
            />
            <Btn type="submit" variant="primary" disabled={headLoading}>
              {headLoading ? "Adicionando..." : "Adicionar"}
            </Btn>
          </form>
        </Card>
      </section>

      {/* ── Section 3: Import ────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Importar centros de custo</SectionTitle>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Envie uma planilha <strong>.xlsx</strong> com as colunas:{" "}
          <code className="rounded bg-[var(--line)] px-1 py-0.5 text-xs">Código</code>,{" "}
          <code className="rounded bg-[var(--line)] px-1 py-0.5 text-xs">Nome</code>,{" "}
          <code className="rounded bg-[var(--line)] px-1 py-0.5 text-xs">Departamento</code>,{" "}
          <code className="rounded bg-[var(--line)] px-1 py-0.5 text-xs">
            E-mail Responsável
          </code>
          ,{" "}
          <code className="rounded bg-[var(--line)] px-1 py-0.5 text-xs">
            Nome Responsável
          </code>
          . Centros existentes são atualizados pelo código.
        </p>

        <Card>
          <div className="p-5">
            {/* Upload zone */}
            <label className="flex cursor-pointer items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-[var(--line)] px-5 py-3 text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {importFile ? importFile.name : "Selecionar arquivo Excel (.xlsx)"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => void handleFileChange(e)}
                className="sr-only"
              />
            </label>

            {importFile && (
              <button
                onClick={() => {
                  setImportFile(null);
                  setPreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="ml-3 text-xs text-[var(--faint)] transition hover:text-[var(--rejected)]"
              >
                Limpar
              </button>
            )}

            {previewLoading && (
              <p className="mt-4 text-sm text-[var(--muted)]">Lendo arquivo...</p>
            )}

            {/* Preview table */}
            {preview && (
              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-[var(--muted)]">
                    <strong className="text-[var(--ink)]">{preview.length}</strong> centro(s)
                    encontrado(s) na planilha
                  </span>
                  <Btn
                    variant="primary"
                    onClick={() => void confirmImport()}
                    disabled={importLoading}
                  >
                    {importLoading ? "Importando..." : "Confirmar importação"}
                  </Btn>
                </div>

                <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--surface)]">
                        <Th>Código</Th>
                        <Th>Nome</Th>
                        <Th>Departamento</Th>
                        <Th>E-mail responsável</Th>
                        <Th>Nome responsável</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-[var(--line)] last:border-0"
                        >
                          <td className="px-4 py-2 font-mono font-semibold text-[var(--accent)]">
                            {row.code}
                          </td>
                          <td className="px-4 py-2">{row.name}</td>
                          <td className="px-4 py-2 text-[var(--muted)]">{row.department}</td>
                          <td className="px-4 py-2 font-mono">
                            {row.head_email ? (
                              <span
                                className={
                                  row.head_email.endsWith("@vammo.com")
                                    ? "text-emerald-600"
                                    : "text-orange-500"
                                }
                              >
                                {row.head_email}
                                {!row.head_email.endsWith("@vammo.com") && " ⚠"}
                              </span>
                            ) : (
                              <span className="text-[var(--faint)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[var(--muted)]">
                            {row.head_name || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-[var(--faint)]">
                  ⚠ E-mails fora de @vammo.com serão ignorados ao vincular responsáveis.
                </p>
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ── Section 4: Test data cleanup ─────────────────────────────────── */}
      <section>
        <SectionTitle>Dados de teste — solicitações</SectionTitle>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Exclui permanentemente uma solicitação e todos os seus documentos, eventos e itens.
          Use apenas para limpar dados de teste.
        </p>
        <Card>
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <span className="text-sm text-[var(--muted)]">
              {requests === null
                ? "Clique em carregar para listar as solicitações."
                : `${requests.length} solicitação(ões) no sistema`}
            </span>
            <Btn
              variant="primary"
              onClick={() => void loadRequests()}
              disabled={requestsLoading}
            >
              {requestsLoading ? "Carregando..." : requests === null ? "Carregar" : "Atualizar"}
            </Btn>
          </div>

          {requests !== null && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)]">
                    <Th>ID</Th>
                    <Th>Solicitante</Th>
                    <Th>Fornecedor</Th>
                    <Th>Centro</Th>
                    <Th>Status</Th>
                    <Th>Valor</Th>
                    <Th>Data</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 ? (
                    <Empty label="Nenhuma solicitação encontrada." />
                  ) : (
                    requests.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-[var(--line)] last:border-0"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[var(--accent)]">
                          {r.display_id}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{r.requester_email}</td>
                        <td className="max-w-[160px] truncate px-4 py-2.5 text-[var(--muted)]">
                          {r.supplier_name}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.cost_centers ? (
                            <span className="font-mono text-xs">{r.cost_centers.code}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs">{STATUS_PT[r.status] ?? r.status}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: r.currency ?? "BRL",
                          }).format(r.total_amount)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                          {new Date(r.created_at).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Btn
                            variant="ghost"
                            disabled={deletingId === r.id}
                            onClick={() => void deleteRequest(r.id, r.display_id)}
                          >
                            {deletingId === r.id ? "Excluindo..." : "Excluir"}
                          </Btn>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
