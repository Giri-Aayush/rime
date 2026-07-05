import { cn } from "@/lib/utils";

/** Small cascade checkmark. Draws in via the `.rime-step-done` ancestor. */
export function TickIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("rime-tick size-3", className)}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

/** The large "restored" checkmark for the recovery payoff. */
export function BigTick({ className }: { className?: string }) {
  return (
    <svg
      className={cn("rime-big-tick size-16", className)}
      viewBox="0 0 52 52"
      aria-hidden="true"
    >
      <circle cx="26" cy="26" r="23" />
      <path d="M15 27l7 7 15-16" />
    </svg>
  );
}
