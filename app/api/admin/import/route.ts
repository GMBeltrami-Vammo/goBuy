import { read, utils } from "xlsx";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ADMIN_EMAIL = "gabriel.beltrami@vammo.com";

interface ImportRow {
  code: string;
  name: string;
  department: string;
  head_email: string;
  head_name: string;
}

// Normalize a column header: lowercase, strip diacritics, collapse non-alphanum to underscore.
function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findCol(row: Record<string, unknown>, patterns: string[]): string {
  const keys = Object.keys(row);
  for (const p of patterns) {
    const k = keys.find((k) => normKey(k).includes(p));
    if (k !== undefined) return String(row[k] ?? "").trim();
  }
  return "";
}

function parseRows(bytes: Buffer): ImportRow[] {
  const wb = read(bytes, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const rows: ImportRow[] = [];
  for (const row of raw) {
    const code = findCol(row, ["codigo", "code", "cod"]);
    const name = findCol(row, ["nome_cc", "nome_centro", "nome", "name"]);
    const department = findCol(row, ["departamento", "department", "area"]);
    // More specific patterns first so "E-mail Responsável" beats a bare "Nome" column
    const headEmail = findCol(row, [
      "email_responsavel",
      "e_mail_responsavel",
      "email_resp",
      "e_mail_resp",
      "email",
      "e_mail",
      "mail",
    ]).toLowerCase();
    const headName = findCol(row, [
      "nome_responsavel",
      "nome_resp",
      "responsavel",
      "head_name",
    ]);

    if (!code || !name) continue;
    rows.push({
      code,
      name,
      department: department || "—",
      head_email: headEmail,
      head_name: headName,
    });
  }

  return rows;
}

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const action = String(form.get("action") ?? "confirm");
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Arquivo acima de 10 MB." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let rows: ImportRow[];
  try {
    rows = parseRows(bytes);
  } catch {
    return NextResponse.json(
      {
        error:
          "Erro ao ler o arquivo. Certifique-se de enviar um .xlsx válido com as colunas: Código, Nome, Departamento, E-mail Responsável, Nome Responsável.",
      },
      { status: 400 },
    );
  }

  if (!rows.length) {
    return NextResponse.json(
      {
        error:
          "Nenhuma linha válida encontrada. A planilha deve ter pelo menos as colunas Código e Nome.",
      },
      { status: 400 },
    );
  }

  if (action === "preview") {
    return NextResponse.json({ rows });
  }

  // action === "confirm": upsert to DB
  const admin = supabaseAdmin();

  const { data: upserted, error: ccError } = await admin
    .from("cost_centers")
    .upsert(
      rows.map((r) => ({
        code: r.code,
        name: r.name,
        department: r.department,
        active: true,
      })),
      { onConflict: "code" },
    )
    .select("id, code");

  if (ccError) {
    return NextResponse.json(
      { error: `Erro ao importar centros: ${ccError.message}` },
      { status: 500 },
    );
  }

  const codeToId = Object.fromEntries(
    (upserted ?? []).map((r) => [r.code as string, r.id as number]),
  );

  const headRows = rows
    .filter((r) => r.head_email.endsWith("@vammo.com") && codeToId[r.code])
    .map((r) => ({
      cost_center_id: codeToId[r.code],
      head_email: r.head_email,
      head_name: r.head_name || null,
    }));

  if (headRows.length) {
    const { error: headError } = await admin
      .from("cost_center_heads")
      .upsert(headRows, { onConflict: "cost_center_id,head_email" });

    if (headError) {
      return NextResponse.json(
        {
          error: `Centros importados, mas houve erro nos responsáveis: ${headError.message}`,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ imported: rows.length, heads_linked: headRows.length });
}
