import { cn } from "@/lib/utils";

/** The eyebrow tag that titles every card / section — a microscopic pill with
 *  a leading node, straight from the wavelength playbook. */
export function SectionLabel({
  children,
  className,
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  /** candy dot color; defaults to a neutral node */
  accent?: "mint" | "blue" | "violet" | "muted";
}) {
  const dot =
    accent === "mint"
      ? "bg-mint"
      : accent === "blue"
        ? "bg-blue"
        : accent === "violet"
          ? "bg-violet"
          : "bg-muted-foreground/50";

  return (
    <div
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-border/70 bg-foreground/2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1 rounded-full", dot)} aria-hidden="true" />
      {children}
    </div>
  );
}
