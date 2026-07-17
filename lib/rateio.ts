import { parseBRLDecimal } from "@/lib/format";

export interface RateioSegment {
  code: string;
  label: string;
  amount: number | null;
  pct: number;
}

// Matches one "CC<code> <label> R$ <amount> (<pct>%)" segment, e.g.
// "CC401 Energia R$ 3.985,20 (80%)". Global + case-insensitive so all segments
// in an observation are captured; the trailing address text is ignored.
const RATEIO_RE = /CC\s*(\d[\d.]*)\s+(.+?)\s+R\$\s*([\d.,]+)\s*\(\s*(\d+)\s*%\)/gi;

/**
 * Parse the rateio breakdown embedded in a charge's observation text, e.g.
 * "Rateio CC401 Energia R$ 3.985,20 (80%) CC402 Aluguel R$ 1.020,00 (20%) …".
 * Returns [] when there's no rateio pattern.
 */
export function parseRateio(observation: string | null | undefined): RateioSegment[] {
  if (!observation) return [];
  const out: RateioSegment[] = [];
  for (const m of observation.matchAll(RATEIO_RE)) {
    out.push({
      code: m[1],
      label: m[2].trim(),
      amount: parseBRLDecimal(m[3]),
      pct: Number(m[4]),
    });
  }
  return out;
}
