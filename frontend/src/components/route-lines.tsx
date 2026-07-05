"use client";

// The signature motif, faithful to wavelength.cx: candy-colored routing
// traces — rounded orthogonal paths, like subway lines or circuit routes —
// reinterpreted for Rime as key shares routing toward one signature.
//
// Prominent but restrained: the traces carry real visual weight, and a small
// number of slow "signal" pulses travel each route (SMIL animateMotion —
// smooth, GPU-cheap, no JS). The motion is deliberately minimal so the whole
// thing reads clean, sleek, professional — not a screensaver.

type Route = {
  d: string;
  color: string;
  w: number;
  /** seconds for a signal to traverse; longer = calmer */
  dur: number;
  delay?: number;
};

// Routes framing the hero: three converge from the left (the three signers),
// two arc in from the right (the treasury). Rounded corners throughout.
const ROUTES: Route[] = [
  { d: "M -40 70 H 150 Q 196 70 196 116 V 250 Q 196 300 246 300 H 560", color: "var(--mint)", w: 2.5, dur: 7 },
  { d: "M -40 150 H 96 Q 142 150 142 196 V 250", color: "var(--blue)", w: 2, dur: 9, delay: 1.5 },
  { d: "M -40 300 H 60 Q 106 300 106 254 V 150", color: "var(--violet)", w: 2, dur: 8, delay: 3 },
  { d: "M 1480 60 H 1250 Q 1204 60 1204 106 V 210 Q 1204 256 1158 256 H 900", color: "var(--violet)", w: 2.5, dur: 8.5, delay: 0.8 },
  { d: "M 1480 340 H 1320 Q 1274 340 1274 294 V 150", color: "var(--mint)", w: 2, dur: 10, delay: 2.2 },
];

// Junction nodes where routes turn — quiet connection points.
const NODES = [
  { x: 196, y: 116, color: "var(--mint)" },
  { x: 246, y: 300, color: "var(--mint)" },
  { x: 142, y: 196, color: "var(--blue)" },
  { x: 106, y: 254, color: "var(--violet)" },
  { x: 1204, y: 106, color: "var(--violet)" },
  { x: 1274, y: 294, color: "var(--mint)" },
];

export function RouteLines({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 1440 440"
        preserveAspectRatio="xMidYMin slice"
        fill="none"
      >
        {/* static traces — carry the visual weight */}
        {ROUTES.map((r, i) => (
          <path
            key={`t${i}`}
            d={r.d}
            stroke={r.color}
            strokeWidth={r.w}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.42}
          />
        ))}

        {/* junction nodes */}
        {NODES.map((n, i) => (
          <g key={`n${i}`}>
            <circle cx={n.x} cy={n.y} r={8} fill={n.color} opacity={0.1} />
            <circle cx={n.x} cy={n.y} r={2.5} fill={n.color} opacity={0.65} />
          </g>
        ))}

        {/* slow travelling signals — the only motion, one per route */}
        {ROUTES.map((r, i) => (
          <circle key={`s${i}`} r={3} fill={r.color}>
            <animateMotion
              path={r.d}
              dur={`${r.dur}s`}
              begin={`${r.delay ?? 0}s`}
              repeatCount="indefinite"
              rotate="auto"
              calcMode="linear"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.08;0.9;1"
              dur={`${r.dur}s`}
              begin={`${r.delay ?? 0}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </svg>
    </div>
  );
}
