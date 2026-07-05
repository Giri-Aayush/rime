import { cn } from "@/lib/utils";

// The "double-bezel" (Doppelrand) shell: a machined outer tray that a card
// sits inside, giving every panel physical depth instead of floating flat on
// the canvas. The inner core keeps its own bg + hairline; this only supplies
// the outer enclosure with concentric radii. Purely presentational.
export function Bezel({
  className,
  children,
  tone = "neutral",
}: {
  className?: string;
  children: React.ReactNode;
  /** an optional accent tint bled into the tray's top edge */
  tone?: "neutral" | "mint" | "blue" | "violet";
}) {
  const wash = {
    neutral: "",
    mint: "before:bg-[radial-gradient(120%_80%_at_50%_-20%,color-mix(in_oklab,var(--mint)_16%,transparent),transparent_70%)]",
    blue: "before:bg-[radial-gradient(120%_80%_at_50%_-20%,color-mix(in_oklab,var(--blue)_16%,transparent),transparent_70%)]",
    violet:
      "before:bg-[radial-gradient(120%_80%_at_50%_-20%,color-mix(in_oklab,var(--violet)_16%,transparent),transparent_70%)]",
  }[tone];

  return (
    <div
      className={cn(
        "relative rounded-[1.65rem] bg-foreground/[0.02] p-[6px] ring-1 ring-foreground/[0.07]",
        "shadow-[0_30px_80px_-50px_rgba(0,0,0,0.95)]",
        tone !== "neutral" &&
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-[1.65rem]",
        wash,
        className,
      )}
    >
      <div className="relative h-full">{children}</div>
    </div>
  );
}
