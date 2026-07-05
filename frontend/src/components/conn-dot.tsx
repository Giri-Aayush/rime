// SSE connection indicator, as a small mono pill. Mint pulses when live, ice
// blinks while connecting, red is offline.

import { cn } from "@/lib/utils";

export function ConnDot({
  status,
  className,
  bare = false,
}: {
  status: "connecting" | "live" | "offline";
  className?: string;
  /** render just the dot + label without the pill chrome */
  bare?: boolean;
}) {
  const tone =
    status === "live"
      ? "text-success"
      : status === "connecting"
        ? "text-primary"
        : "text-destructive";
  const dot =
    status === "live"
      ? "bg-success rime-dot-pulse"
      : status === "connecting"
        ? "bg-primary rime-live-dot"
        : "bg-destructive";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em]",
        !bare &&
          "rounded-full border border-border bg-foreground/2 px-3 py-1.5 backdrop-blur-sm",
        tone,
        className,
      )}
    >
      <span className={cn("size-[7px] rounded-full", dot)} aria-hidden="true" />
      {status === "live" ? "live" : status}
    </span>
  );
}
