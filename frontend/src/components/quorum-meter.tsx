// approvals / threshold progress. Fills to ice; turns mint-green at quorum.

import { cn } from "@/lib/utils";
import type { PaymentRequest } from "@/lib/types";

export function QuorumMeter({
  req,
  threshold,
  className,
}: {
  req: PaymentRequest;
  threshold: number;
  className?: string;
}) {
  const need = threshold;
  const got = ["quorum", "signing", "broadcast"].includes(req.status)
    ? need
    : Math.min(req.approvals ?? 0, need);
  const pct = Math.round((got / need) * 100);
  const full = got >= need;

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            full
              ? "bg-gradient-to-r from-primary to-success"
              : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        <strong className="font-semibold text-primary">{got}</strong>/{need}{" "}
        approvals
      </span>
    </div>
  );
}
