// Decorative circuit detail for the side gutters of the circuit ambient
// effect — real traces, pads and vias. Purely visual (aria-hidden); shown only
// when the circuit effect is active (parent .circuit is gated on html.fx-circuit).

/** A tiling strip of circuit traces. `id` must be unique per instance so the
 *  two sides don't collide on the SVG pattern reference. */
function CircuitStrip({ id }: { id: string }) {
  return (
    <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} width="80" height="120" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#2EC2FF" strokeWidth="1.1">
            <path d="M56 -4V124" />
            <path d="M24 16V104" />
            <path d="M56 20H24" />
            <path d="M56 64H38V92" />
            <path d="M24 40H8" />
            <path d="M24 84H40" />
          </g>
          <g fill="#2EC2FF">
            <circle cx="56" cy="20" r="2.2" />
            <circle cx="24" cy="20" r="2.2" />
            <rect x="5" y="37" width="6" height="6" rx="1" />
            <circle cx="56" cy="64" r="2.2" />
            <rect x="35" y="89" width="6" height="6" rx="1" />
            <circle cx="24" cy="40" r="1.8" />
            <circle cx="40" cy="84" r="2" />
            <circle cx="24" cy="104" r="2.2" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function CircuitSides() {
  return (
    <>
      <div className="circuit-side circuit-side-left" aria-hidden="true">
        <CircuitStrip id="cs-l" />
      </div>
      <div className="circuit-side circuit-side-right" aria-hidden="true">
        <CircuitStrip id="cs-r" />
      </div>
    </>
  );
}
