import { parseBRLDecimal } from "@/lib/format";

export interface RateioSegment {
  code: string;
  label: string;
  amount: number | null;
  pct: number;
}

// Strict, richest format: "CC<code> <label> R$ <amount> (<pct>%)", e.g.
// "CC401 Energia R$ 3.985,20 (80%)". Carries an explicit label + percentage.
const RATEIO_STRICT_RE = /CC\s*(\d[\d.]*)\s+(.+?)\s+R\$\s*([\d.,]+)\s*\(\s*(\d+)\s*%\)/gi;

// Tolerant fallback for the leaner formats the source sheets also produce, e.g.
// "CC - 1501 - 4971,55", "CC 1501 4971,55", "CC1501: R$ 4.971,55" — separators
// may be dash/colon/space, "R$" and the "(NN%)" are optional, and there is no
// label. Captures code, amount and (optional) percentage.
const RATEIO_LOOSE_RE =
  /CC\s*[-–:]*\s*(\d[\d.]*)\s*[-–:]*\s*(?:R\$\s*)?(\d[\d.]*(?:,\d{1,2})?)\s*(?:\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\))?/gi;

/**
 * Parse the rateio breakdown embedded in a charge's observation text. Tries the
 * strict "CC<code> <label> R$ <amount> (<pct>%)" format first (keeps labels and
 * explicit percentages); if none match, falls back to the leaner
 * "CC - <code> - <amount>" style and DERIVES each percentage from the amounts
 * (amount ÷ total). Returns [] when there's no rateio pattern at all.
 *
 * Note: a single observation is assumed to use one format; a mix of strict and
 * lean segments would surface only the strict ones.
 */
export function parseRateio(observation: string | null | undefined): RateioSegment[] {
  if (!observation) return [];

  const strict: RateioSegment[] = [];
  for (const m of observation.matchAll(RATEIO_STRICT_RE)) {
    strict.push({ code: m[1], label: m[2].trim(), amount: parseBRLDecimal(m[3]), pct: Number(m[4]) });
  }
  if (strict.length > 0) return strict;

  const loose: { code: string; amount: number | null; pct: number | null }[] = [];
  for (const m of observation.matchAll(RATEIO_LOOSE_RE)) {
    loose.push({
      code: m[1],
      amount: parseBRLDecimal(m[2]),
      pct: m[3] != null ? Math.round(Number(m[3].replace(",", "."))) : null,
    });
  }
  if (loose.length === 0) return [];

  const total = loose.reduce((sum, x) => sum + (x.amount ?? 0), 0);
  return loose.map((x) => ({
    code: x.code,
    label: "",
    amount: x.amount,
    pct: x.pct ?? (total > 0 && x.amount != null ? Math.round((x.amount / total) * 100) : 0),
  }));
}

/**
 * How a charge's amount is attributed to cost centers for budget purposes.
 * With a rateio, each segment's amount goes to its own CC (mapped via codeToId,
 * skipping CCs the viewer can't resolve). Without one, the full amount goes to
 * the charge's single cost_center_id. Approval stays single (the primary CC).
 */
export function chargeContributions(
  charge: { observation: string | null; cost_center_id: number; amount: number },
  codeToId: Map<string, number>,
): { id: number; amount: number }[] {
  const segs = parseRateio(charge.observation);
  if (segs.length > 0) {
    return segs.flatMap((s) => {
      const id = codeToId.get(s.code);
      return id != null && s.amount != null ? [{ id, amount: s.amount }] : [];
    });
  }
  return [{ id: charge.cost_center_id, amount: Number(charge.amount) }];
}
