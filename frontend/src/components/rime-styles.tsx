// Frost-specific motion the design leans on: the checkmark cascade, the
// active-step pulse, the connection dot, and the two deliberate reveals —
// the signing ceremony and the recovery "thaw". Keyframes reference the
// theme tokens only (no hardcoded hex), so they stay on-palette. Injected as
// a plain <style> element to keep globals.css untouched.

const CSS = `
@keyframes rime-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes rime-blink { 50% { opacity: 0.25; } }
@keyframes rime-pulse-dot {
  0%   { box-shadow: 0 0 0 0 color-mix(in oklab, var(--success) 45%, transparent); }
  70%  { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes rime-node-pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in oklab, var(--primary) 45%, transparent); }
  70%  { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes rime-chip-glow {
  50% { box-shadow: 0 0 12px -2px color-mix(in oklab, var(--primary) 55%, transparent); }
}
@keyframes rime-frost-flicker { 50% { opacity: 0.55; } }
@keyframes rime-ring-draw { to { stroke-dashoffset: 0; } }
@keyframes rime-tick-draw { to { stroke-dashoffset: 0; } }
@keyframes rime-thaw {
  0%   { filter: grayscale(0.9) brightness(0.6); box-shadow: 0 0 0 rgba(0,0,0,0); }
  35%  { filter: none; box-shadow: 0 0 46px -6px color-mix(in oklab, var(--success) 65%, transparent); }
  70%  { box-shadow: 0 0 34px -10px color-mix(in oklab, var(--primary) 50%, transparent); }
  100% { filter: none; box-shadow: 0 18px 40px -20px rgba(0,0,0,0.95); }
}

.rime-rise { animation: rime-rise 0.32s ease both; }
.rime-live-dot { animation: rime-blink 1.1s ease infinite; }
.rime-dot-pulse { animation: rime-pulse-dot 2.2s ease-out infinite; }
.rime-node-pulse { animation: rime-node-pulse 1.5s ease-out infinite; }
.rime-chip-glow { animation: rime-chip-glow 1.4s ease-in-out infinite; }
.rime-flicker { animation: rime-frost-flicker 3.5s ease-in-out infinite; }
.rime-thaw { animation: rime-thaw 1.7s cubic-bezier(0.22, 1, 0.36, 1); }

/* checkmark cascade — the tick draws in when its step lands */
.rime-tick { display: block; }
.rime-tick path {
  stroke: currentColor; stroke-width: 2.4; fill: none;
  stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 16; stroke-dashoffset: 16;
}
.rime-step-done .rime-tick path { stroke-dashoffset: 0; transition: stroke-dashoffset 0.4s ease 0.1s; }

/* the payoff checkmark for a completed recovery */
.rime-big-tick circle {
  fill: none; stroke: currentColor; stroke-width: 2; opacity: 0.35;
  stroke-dasharray: 151; stroke-dashoffset: 151;
  animation: rime-ring-draw 0.6s ease-out forwards;
}
.rime-big-tick path {
  fill: none; stroke: currentColor; stroke-width: 3.2;
  stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 34; stroke-dashoffset: 34;
  animation: rime-tick-draw 0.4s ease-out 0.4s forwards;
  filter: drop-shadow(0 0 10px currentColor);
}

@media (prefers-reduced-motion: reduce) {
  .rime-rise, .rime-live-dot, .rime-dot-pulse, .rime-node-pulse, .rime-chip-glow,
  .rime-flicker, .rime-thaw, .rime-big-tick circle, .rime-big-tick path {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
  .rime-tick path { transition-duration: 0.01ms !important; }
}
`;

export function RimeStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
