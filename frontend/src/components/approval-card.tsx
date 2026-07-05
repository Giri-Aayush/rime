// A single payment request as it appears on a signer's phone: reason,
// amount, recipient, quorum meter, and — depending on the queue it's in —
// approve/reject actions, a "signing" state, or the decision you already made.

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QuorumMeter } from "@/components/quorum-meter";
import { fmtZat, truncMid } from "@/lib/rime";
import type { PaymentRequest } from "@/lib/types";

interface ApprovalCardProps {
  req: PaymentRequest;
  kind: "open" | "others" | "decided";
  decision?: "approve" | "reject";
  threshold: number;
  unit: string;
  large?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

export function ApprovalCard({
  req,
  kind,
  decision,
  threshold,
  unit,
  large = false,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  return (
    <div
      className={cn(
        "rime-rise rounded-xl border bg-card/85 p-3",
        large && "rounded-[18px] p-4",
        kind === "open"
          ? "border-primary/30 shadow-[0_0_20px_-12px_var(--primary)]"
          : "border-border",
      )}
    >
      <div className={cn("font-semibold", large ? "text-[17px]" : "text-[13px]")}>
        {req.reason}
      </div>

      <div className="mt-1 font-mono text-primary">
        <span className={large ? "text-[23px]" : "text-[15px]"}>
          {fmtZat(req.amount_zat)}
        </span>
        <span
          className={cn(
            "ml-1 text-muted-foreground",
            large ? "text-[12px]" : "text-[10.5px]",
          )}
        >
          {unit}
        </span>
      </div>

      <div
        className={cn(
          "mt-1 break-all font-mono text-muted-foreground",
          large ? "text-[12px]" : "text-[10.5px]",
        )}
        title={req.recipient}
      >
        → {truncMid(req.recipient, 14, 10)}
      </div>

      <QuorumMeter
        req={req}
        threshold={threshold}
        className={large ? "mt-3" : "mt-2.5"}
      />

      {kind === "open" && (
        <div className={cn("mt-3 flex gap-2", large && "mt-4 gap-2.5")}>
          <Button
            type="button"
            variant="outline"
            onClick={onApprove}
            className={cn(
              "flex-1 border-primary/35 bg-primary/15 font-semibold text-primary hover:bg-primary/25 hover:text-primary",
              large && "min-h-[54px] rounded-[14px] text-base",
            )}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onReject}
            className={cn(
              "flex-1 border-border bg-transparent font-semibold text-muted-foreground hover:border-destructive/40 hover:text-destructive",
              large && "min-h-[54px] rounded-[14px] text-base",
            )}
          >
            Reject
          </Button>
        </div>
      )}

      {kind === "others" && (
        <div
          className={cn(
            "mt-2.5 flex items-center gap-2 font-semibold uppercase tracking-[0.06em] text-primary",
            large ? "text-[13px]" : "text-[11.5px]",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          quorum reached — signing
        </div>
      )}

      {kind === "decided" && (
        <div
          className={cn(
            "mt-2.5 flex items-center gap-2 font-semibold uppercase tracking-[0.06em]",
            decision === "approve" ? "text-success" : "text-destructive",
            large ? "text-[13px]" : "text-[11.5px]",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {decision === "approve" ? "you approved" : "you rejected"}
        </div>
      )}
    </div>
  );
}
