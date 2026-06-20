// Connected circuit board for the "circuit" ambient effect. Hand-authored,
// non-repeating traces span both side borders of a 1000×600 viewBox that is
// stretched edge-to-edge (preserveAspectRatio="none"). A few traces carry a
// soft "ball of light" that rides the trace via SVG animateMotion — a small
// element moving along the path is compositor-friendly and far cheaper than
// re-rasterising a long animated dash each frame. Decorative (aria-hidden);
// shown only when the circuit effect is active (.circuit is gated on
// html.fx-circuit).

type Trace = { d: string; dur: number; delay: number; pulse: boolean };

// Each path starts at x=0 (left border) and ends at x=1000 (right border),
// routed with orthogonal runs and 45° elbows for a circuit-board feel.
const TRACES: Trace[] = [
  { d: "M0 64 H150 L196 110 H352 L398 70 H556 L604 118 H760 L812 64 H1000", dur: 13, delay: 0, pulse: true },
  { d: "M0 150 H120 L168 198 H300 L348 150 H612 L656 192 H840 L884 150 H1000", dur: 16, delay: 5, pulse: false },
  { d: "M0 238 H214 L262 196 H440 L488 244 H700 L756 206 H1000", dur: 12, delay: 2.5, pulse: true },
  { d: "M0 300 H300 L352 350 H520 L584 300 H1000", dur: 15, delay: 7.5, pulse: true },
  { d: "M0 372 H160 L208 420 H380 L428 372 H648 L700 414 H1000", dur: 17, delay: 1.5, pulse: false },
  { d: "M0 452 H262 L306 412 H470 L520 462 H722 L780 420 H1000", dur: 12.5, delay: 4, pulse: true },
  { d: "M0 536 H180 L240 494 H420 L470 536 H700 L752 498 H1000", dur: 14.5, delay: 9, pulse: true },
];

// Sparse junction dots / pads.
const NODES: [number, number][] = [
  [150, 64], [352, 110], [760, 118],
  [214, 238], [700, 244],
  [300, 300], [520, 350],
  [262, 452], [722, 462],
  [420, 536], [700, 536],
];

export function CircuitNet() {
  return (
    <svg className="circuit-net" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {/* The travelling light — bright core fading to transparent (soft ball). */}
        <radialGradient id="netBall">
          <stop offset="0%" stopColor="#eaf7ff" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#5fd2ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#2ec2ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="net-base">
        {TRACES.map((t, i) => (
          <path key={i} d={t.d} />
        ))}
      </g>
      <g className="net-nodes">
        {NODES.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" />
        ))}
      </g>
      <g className="net-pulses">
        {TRACES.filter((t) => t.pulse).map((t, i) => (
          <circle key={i} r="8" fill="url(#netBall)">
            <animateMotion path={t.d} dur={`${t.dur}s`} begin={`${t.delay}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </g>
    </svg>
  );
}
