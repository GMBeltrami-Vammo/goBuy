import type { CSSProperties } from "react";

// Connected circuit board for the "circuit" ambient effect. Hand-authored,
// non-repeating traces span both side borders of a 1000×600 viewBox stretched
// edge-to-edge (preserveAspectRatio="none"). Routing wanders vertically (V/L
// jogs) and a few short cross-links interconnect adjacent traces, so it reads
// as a circuit rather than parallel horizontals. A few traces carry one short,
// bright, widened SECTION of wire that streaks along like current — staggered
// so only ~1–2 are visible at any moment. Decorative (aria-hidden); shown only
// when the circuit effect is active (.circuit is gated on html.fx-circuit).

type Pulse = { d: string; dur: number; delay: number };

// Main traces — each touches x=0 (left border) and x=1000 (right border), but
// jogs up/down so the path is not a straight horizontal.
const MAIN: string[] = [
  "M0 70 H140 V120 H280 L330 80 H470 V140 H640 L690 96 H860 V150 H1000", // M1
  "M0 210 H110 L160 170 H260 V250 H420 L470 210 H600 V270 H760 L810 220 H1000", // M2
  "M0 320 H180 V270 H320 L370 320 H520 V360 H680 L730 320 H1000", // M3
  "M0 400 H120 L170 440 H300 V370 H460 L510 420 H660 V460 H820 L870 410 H1000", // M4
  "M0 500 H160 V460 H320 L370 500 H540 V540 H700 L750 500 H1000", // M5
  "M0 560 H240 L290 520 H460 V568 H640 L690 528 H1000", // M6
];

// Short vertical links between adjacent traces — a handful of interconnections,
// not a lattice.
const LINKS: string[] = [
  "M210 120 V170",
  "M395 250 V320",
  "M430 320 V370",
  "M525 420 V500",
  "M415 500 V520",
  "M920 150 V220",
];

// Traces that carry a travelling streak. Long, varied, staggered durations keep
// the screen to roughly one or two streaks at a time.
const PULSES: Pulse[] = [
  { d: MAIN[0], dur: 21, delay: 0 },
  { d: MAIN[2], dur: 24, delay: 6 },
  { d: MAIN[3], dur: 20, delay: 12 },
  { d: MAIN[5], dur: 23, delay: 3 },
];

// Sparse junction dots.
const NODES: [number, number][] = [
  [210, 120], [470, 80], [260, 170], [395, 320], [430, 370],
  [730, 320], [660, 420], [525, 500], [415, 520], [920, 220],
];

export function CircuitNet() {
  return (
    <svg className="circuit-net" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
      <g className="net-base">
        {MAIN.map((d, i) => (
          <path key={`m${i}`} d={d} />
        ))}
        {LINKS.map((d, i) => (
          <path key={`l${i}`} d={d} />
        ))}
      </g>
      <g className="net-nodes">
        {NODES.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" />
        ))}
      </g>
      <g className="net-pulses">
        {PULSES.map((t, i) => {
          const style = { animationDuration: `${t.dur}s`, animationDelay: `${t.delay}s` } as CSSProperties;
          return (
            <g key={i}>
              <path className="net-pulse-glow" d={t.d} pathLength={100} style={style} />
              <path className="net-pulse-core" d={t.d} pathLength={100} style={style} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
