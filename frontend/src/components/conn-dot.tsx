// SSE connection indicator. Green pulses when live, ice blinks while
// connecting, red is offline.

import { cn } from "@/lib/utils";

export function ConnDot({
  status,
  className,
}: {
  status: "connecting" | "live" | "offline";
  className?: string;
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
        "inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em]",
        tone,
        className,
      )}
    >
      <span className={cn("size-[7px] rounded-full", dot)} aria-hidden="true" />
      {status === "live" ? "live" : status}
    </span>
  );
}
