import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isVammoEmail } from "@/lib/auth";
import { isSameOriginFetch } from "@/lib/http";
import type { CnpjLookup } from "@/lib/types";

export const runtime = "nodejs";

// BrasilAPI public CNPJ endpoint (no key). Overridable for testing.
const CNPJ_API = process.env.CNPJ_API_URL ?? "https://brasilapi.com.br/api/cnpj/v1";

// Short-TTL in-memory success cache (per server instance). Cuts repeat lookups
// of the same CNPJ and softens BrasilAPI's shared free-tier quota. This is a
// cheap mitigation, not a substitute for a shared-store per-user rate limiter.
const CACHE_TTL_MS = 1000 * 60 * 60; // 1h
const CACHE_MAX = 1000;
const cache = new Map<string, { at: number; data: CnpjLookup }>();

const CEP = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d || null;
};

const PHONE = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || null;
};

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

/** Raw shape of the fields we read off the BrasilAPI response. */
interface BrasilApiCnpj {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  situacao_cadastral?: number;
  descricao_situacao_cadastral?: string;
  descricao_tipo_de_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  email?: string;
  cnae_fiscal_descricao?: string;
  natureza_juridica?: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cnpj: string }> },
) {
  // Same-origin fetch + @vammo session — this is an internal lookup helper.
  if (!isSameOriginFetch(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user?.email || !isVammoEmail(session.user.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { cnpj } = await params;
  const digits = (cnpj ?? "").replace(/\D/g, "");
  if (digits.length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido — informe 14 dígitos." }, { status: 400 });
  }

  const hit = cache.get(digits);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data);
  }

  // Guard against a hung upstream so the Verify button always resolves.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let res: Response;
  try {
    res = await fetch(`${CNPJ_API}/${digits}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch (err) {
    console.error("[api/cnpj] upstream fetch failed:", err);
    return NextResponse.json(
      { error: "Serviço de consulta de CNPJ indisponível. Tente novamente." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    return NextResponse.json({ error: "CNPJ não encontrado na Receita." }, { status: 404 });
  }
  if (res.status === 429) {
    return NextResponse.json(
      { error: "Muitas consultas ao serviço de CNPJ. Tente novamente em instantes." },
      { status: 429 },
    );
  }
  if (!res.ok) {
    console.error("[api/cnpj] upstream status:", res.status);
    return NextResponse.json(
      { error: "Não foi possível consultar o CNPJ agora. Tente novamente." },
      { status: 502 },
    );
  }

  let raw: BrasilApiCnpj;
  try {
    raw = (await res.json()) as BrasilApiCnpj;
  } catch {
    return NextResponse.json({ error: "Resposta inválida do serviço de CNPJ." }, { status: 502 });
  }

  const razao = str(raw.razao_social);
  if (!razao) {
    return NextResponse.json({ error: "CNPJ sem razão social na base." }, { status: 422 });
  }

  const enderecoParts = [
    [str(raw.descricao_tipo_de_logradouro), str(raw.logradouro)].filter(Boolean).join(" "),
    str(raw.numero),
    str(raw.complemento),
  ].filter(Boolean);

  const result: CnpjLookup = {
    cnpj: digits,
    razao_social: razao,
    nome_fantasia: str(raw.nome_fantasia),
    situacao_cadastral: str(raw.descricao_situacao_cadastral) ?? "—",
    ativa: raw.situacao_cadastral === 2,
    endereco: enderecoParts.length ? enderecoParts.join(", ") : null,
    bairro: str(raw.bairro),
    municipio: str(raw.municipio),
    uf: str(raw.uf),
    cep: CEP(raw.cep),
    telefone: PHONE(raw.ddd_telefone_1),
    email: str(raw.email),
    cnae: str(raw.cnae_fiscal_descricao),
    natureza_juridica: str(raw.natureza_juridica),
  };

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(digits, { at: Date.now(), data: result });

  return NextResponse.json(result);
}
