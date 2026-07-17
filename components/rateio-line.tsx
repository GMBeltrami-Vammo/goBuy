import { formatBRL } from "@/lib/format";
import { parseRateio } from "@/lib/rateio";

/** Compact display of a charge's rateio (parsed from its observation text).
 *  Renders nothing when there's no rateio. */
export function RateioLine({ observation }: { observation: string | null }) {
  const segs = parseRateio(observation);
  if (segs.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="v-tabular text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">
        Rateio
      </span>
      {segs.map((s, i) => (
        <span
          key={i}
          title={s.label}
          className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 v-tabular text-[10px] text-[var(--muted)]"
        >
          {s.code} · {s.pct}%{s.amount != null ? ` · ${formatBRL(s.amount)}` : ""}
        </span>
      ))}
    </div>
  );
}
