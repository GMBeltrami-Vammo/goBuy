import type { CSSProperties } from "react";

// Connected circuit board for the "circuit" ambient effect. Hand-authored,
// non-repeating traces span both side borders of a 1000×600 viewBox stretched
// edge-to-edge (preserveAspectRatio="none"). Routing changes height via 45°
// diagonals (no right-angle jogs), with a few diagonal cross-links between
// adjacent traces and sparse junction nodes. A few traces carry one short,
// bright, widened SECTION of wire that streaks along like current — staggered
// so only ~1–2 are visible at any moment. Decorative (aria-hidden); shown only
// when the circuit effect is active (.circuit is gated on html.fx-circuit).

type Pulse = { d: string; dur: number; delay: number };

// Main traces — each touches x=0 (left border) and x=1000 (right border) and
// shifts height only via 45° diagonals (L with equal dx/dy), so bends are 135°,
// never 90°.
const MAIN: string[] = [
  "M0 70 H120 L170 120 H280 L320 80 H470 L520 130 H660 L700 90 H860 L910 140 H1000", // M1
  "M0 210 H110 L160 160 H280 L330 210 H470 L510 170 H640 L690 220 H800 L850 170 H1000", // M2
  "M0 320 H160 L210 270 H330 L380 320 H520 L560 280 H690 L740 330 H1000", // M3
  "M0 400 H120 L170 450 H300 L340 410 H470 L520 460 H660 L710 410 H840 L890 460 H1000", // M4
  "M0 500 H150 L200 450 H330 L380 500 H540 L590 550 H700 L750 500 H1000", // M5
  "M0 560 H230 L280 510 H460 L510 560 H650 L700 510 H1000", // M6
];

// Diagonal (45°) links between adjacent traces — a handful of interconnections.
const LINKS: string[] = [
  "M210 120 L250 160",
  "M560 170 L670 280",
  "M380 320 L470 410",
  "M590 460 L680 550",
  "M290 450 L350 510",
  "M910 140 L940 170",
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
  [170, 120], [320, 80], [510, 170], [670, 280], [380, 320],
  [470, 410], [590, 460], [350, 510], [750, 500], [940, 170],
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
