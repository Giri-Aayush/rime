import { cn } from "@/lib/utils";
import { SIGNER_ACCENT } from "@/components/signer-identity";

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
  const accent = SIGNER_ACCENT[hue];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-primary-foreground ring-2 ring-inset",
        accent.gradient,
        muted ? "opacity-70 grayscale ring-white/10" : cn("ring-white/25", accent.glow),
        size === "lg" ? "size-12 text-[19px]" : "size-[34px] text-sm",
        className,
      )}
      aria-hidden="true"
    >
      {name[0] || "?"}
    </span>
  );
}
