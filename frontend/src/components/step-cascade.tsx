// The animated checkmark pipeline shared by the ceremony strip and the
// recovery panel. Steps light up left-to-right; the current step pulses; a
// failure marks the point it broke with an ✕.

import { cn } from "@/lib/utils";
import { TickIcon } from "@/components/tick-icons";

interface StepCascadeProps {
  order: readonly string[];
  labels: Record<string, string>;
  /** highest index reached (-1 = none yet). */
  reached: number;
  /** a live run is in progress (drives the pulsing "active" node). */
  active: boolean;
  failed: boolean;
  finished: boolean;
  size?: "lg" | "sm";
}

export function StepCascade({
  order,
  labels,
  reached,
  active,
  failed,
  finished,
  size = "lg",
}: StepCascadeProps) {
  const failAt = failed ? Math.min(reached + 1, order.length - 1) : -1;
  const lg = size === "lg";

  return (
    <div
      className={cn(
        "flex items-start overflow-x-auto pb-0.5",
        !lg && "gap-0",
      )}
    >
      {order.map((step, i) => {
        let stateCls = "";
        let nodeCls =
          "border-border bg-background text-transparent"; // idle
        let labelCls = "text-muted-foreground/60";
        let content: React.ReactNode = <TickIcon />;

        if (failed && i === failAt) {
          nodeCls = "border-destructive bg-destructive/10 text-destructive";
          labelCls = "text-destructive";
          content = <span className="text-[11px] font-bold leading-none">✕</span>;
        } else if (i <= reached) {
          stateCls = "rime-step-done";
          nodeCls = "border-primary bg-primary/15 text-primary";
          labelCls = "text-muted-foreground";
        } else if (!failed && !finished && active && i === reached + 1) {
          nodeCls = "border-primary text-transparent rime-node-pulse";
          labelCls = "text-primary";
        }

        const linkDone = i <= reached - 1;
        const isLast = i === order.length - 1;

        return (
          <div key={step} className="flex items-start">
            <div
              className={cn(
                "flex flex-col items-center gap-1.5",
                lg ? "min-w-[78px] flex-none" : "min-w-0 flex-1 basis-0 gap-1",
              )}
            >
              <span
                className={cn(
                  "grid place-items-center rounded-full border-[1.5px] transition-colors",
                  lg ? "size-[22px]" : "size-5",
                  stateCls,
                  nodeCls,
                )}
              >
                {content}
              </span>
              <span
                className={cn(
                  "text-center uppercase leading-tight tracking-[0.08em] transition-colors",
                  lg ? "text-[9.5px]" : "text-[9px]",
                  labelCls,
                )}
              >
                {labels[step] ?? step}
              </span>
            </div>
            {!isLast && (
              <span
                className={cn(
                  "h-[1.5px] shrink self-start transition-colors",
                  lg ? "min-w-[14px] flex-1 mt-[10px]" : "min-w-[8px] flex-1 mt-[9px]",
                  linkDone
                    ? "bg-gradient-to-r from-primary to-primary/60"
                    : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
