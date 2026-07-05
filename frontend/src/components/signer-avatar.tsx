import { cn } from "@/lib/utils";

const HUE: Record<string, string> = {
  a: "from-chart-2 to-primary", // Alice — ice
  b: "from-chart-5 to-chart-3", // Bob — indigo
  c: "from-chart-4 to-success", // Carol — mint
};

export function SignerAvatar({
  hue,
  name,
  size = "sm",
  muted = false,
  className,
}: {
  hue: "a" | "b" | "c";
  name: string;
  size?: "sm" | "lg";
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-primary-foreground",
        HUE[hue],
        size === "lg" ? "size-12 text-[19px]" : "size-[34px] text-sm",
        muted
          ? "opacity-70 grayscale"
          : "shadow-[0_0_14px_-3px_var(--primary)]",
        className,
      )}
      aria-hidden="true"
    >
      {name[0] || "?"}
    </span>
  );
}
