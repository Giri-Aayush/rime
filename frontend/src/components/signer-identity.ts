// Per-signer candy identity — the wavelength move of giving each data owner a
// distinct saturated accent. Keys match SignerConfig.hue (a=Alice, b=Bob,
// c=Carol). Class strings are LITERAL so Tailwind can see them; never build
// these with interpolation.

export interface SignerAccent {
  /** short label of the accent, handy for aria/debug */
  key: "violet" | "mint" | "blue";
  /** the raw CSS var, for inline shadows/text-shadow */
  cssVar: string;
  text: string;
  dot: string;
  soft: string;
  softer: string;
  border: string;
  ring: string;
  gradient: string;
  glow: string;
  /** color-block wash for a phone/device header (wavelength's bold blocks) */
  block: string;
}

// a → Alice (violet), b → Bob (mint), c → Carol (blue)
export const SIGNER_ACCENT: Record<"a" | "b" | "c", SignerAccent> = {
  a: {
    key: "violet",
    cssVar: "var(--violet)",
    text: "text-violet",
    dot: "bg-violet",
    soft: "bg-violet/10",
    softer: "bg-violet/[0.06]",
    border: "border-violet/30",
    ring: "ring-violet/45",
    gradient: "from-violet to-blue",
    glow: "shadow-[0_0_20px_-5px_var(--violet)]",
    block: "bg-gradient-to-b from-violet/[0.12] to-transparent",
  },
  b: {
    key: "mint",
    cssVar: "var(--mint)",
    text: "text-mint",
    dot: "bg-mint",
    soft: "bg-mint/10",
    softer: "bg-mint/[0.06]",
    border: "border-mint/30",
    ring: "ring-mint/45",
    gradient: "from-mint to-success",
    glow: "shadow-[0_0_20px_-5px_var(--mint)]",
    block: "bg-gradient-to-b from-mint/[0.12] to-transparent",
  },
  c: {
    key: "blue",
    cssVar: "var(--blue)",
    text: "text-blue",
    dot: "bg-blue",
    soft: "bg-blue/10",
    softer: "bg-blue/[0.06]",
    border: "border-blue/30",
    ring: "ring-blue/45",
    gradient: "from-blue to-violet",
    glow: "shadow-[0_0_20px_-5px_var(--blue)]",
    block: "bg-gradient-to-b from-blue/[0.12] to-transparent",
  },
};
