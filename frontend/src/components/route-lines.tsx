"use client";

// The signature motif, borrowed from wavelength.cx and reinterpreted for Rime:
// candy-colored "signing routes" — rounded orthogonal traces, like subway
// lines or circuit paths — that read as key shares routing toward one
// signature. Purely decorative, absolutely positioned, pointer-events-none.
// Kept low-opacity so it sets atmosphere without fighting the data.

const ROUTES = [
  { d: "M -20 60 H 120 Q 160 60 160 100 V 240 Q 160 280 200 280 H 520", color: "var(--mint)", w: 3, dash: false },
  { d: "M 1460 40 H 1240 Q 1200 40 1200 80 V 200 Q 1200 240 1160 240 H 900", color: "var(--violet)", w: 3, dash: false },
  { d: "M -20 200 H 60 Q 100 200 100 240 V 420", color: "var(--blue)", w: 2.5, dash: true },
  { d: "M 1460 340 H 1300 Q 1260 340 1260 300 V 140", color: "var(--mint)", w: 2, dash: true },
];

// Little "nodes" that sit on the routes, like connection points.
const NODES = [
  { x: 160, y: 100, color: "var(--mint)" },
  { x: 200, y: 280, color: "var(--mint)" },
  { x: 1200, y: 80, color: "var(--violet)" },
  { x: 100, y: 240, color: "var(--blue)" },
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
        {ROUTES.map((r, i) => (
          <path
            key={i}
            d={r.d}
            stroke={r.color}
            strokeWidth={r.w}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={r.dash ? "2 10" : undefined}
            opacity={0.5}
            style={
              r.dash
                ? { animation: `rime-route-flow ${8 + i * 2}s linear infinite` }
                : undefined
            }
          />
        ))}
        {NODES.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={7} fill={n.color} opacity={0.14} />
            <circle cx={n.x} cy={n.y} r={2.5} fill={n.color} opacity={0.7} />
          </g>
        ))}
      </svg>
    </div>
  );
}
