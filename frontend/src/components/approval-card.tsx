// A single payment request as it appears on a signer's phone: reason,
// amount, recipient, quorum meter, and — depending on the queue it's in —
// approve/reject actions, a "signing" state, or the decision you already made.

import { cn } from "@/lib/utils";
import { QuorumMeter } from "@/components/quorum-meter";
import { CheckMini } from "@/components/island-button";
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

function XMini({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
    </svg>
  );
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
        "rime-rise rounded-2xl border bg-card/85 p-3.5",
        large && "rounded-[20px] p-4",
        kind === "open"
          ? "border-primary/30 shadow-[0_0_28px_-16px_var(--primary)]"
          : "border-border",
      )}
    >
      <div className={cn("font-semibold", large ? "text-[17px]" : "text-[13px]")}>
        {req.reason}
      </div>

      <div className="mt-1.5 font-mono tabular-nums text-foreground">
        <span
          className={cn(
            "tracking-tight",
            large ? "text-[26px] leading-none" : "text-[16px]",
          )}
        >
          {fmtZat(req.amount_zat)}
        </span>
        <span
          className={cn("ml-1 text-primary", large ? "text-[12px]" : "text-[10.5px]")}
        >
          {unit}
        </span>
      </div>

      <div
        className={cn(
          "mt-1 break-all font-mono text-muted-foreground/80",
          large ? "text-[12px]" : "text-[10.5px]",
        )}
        title={req.recipient}
      >
        → {truncMid(req.recipient, 14, 10)}
      </div>

      <QuorumMeter
        req={req}
        threshold={threshold}
        className={large ? "mt-3.5" : "mt-3"}
      />

      {kind === "open" && (
        <div className={cn("mt-3.5 flex gap-2", large && "mt-4 gap-2.5")}>
          <button
            type="button"
            onClick={onApprove}
            className={cn(
              "group/ap flex flex-1 items-center justify-center gap-2 rounded-full border border-primary/35 bg-primary/15 font-semibold text-primary transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary/25 active:scale-[0.97]",
              large ? "min-h-[54px] text-base" : "min-h-9 text-[13px]",
            )}
          >
            Approve
            <span className="grid size-5 place-items-center rounded-full bg-primary/25 transition-transform duration-300 group-hover/ap:scale-110">
              <CheckMini className="size-3" />
            </span>
          </button>
          <button
            type="button"
            onClick={onReject}
            className={cn(
              "group/rj flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-transparent font-semibold text-muted-foreground transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-destructive/40 hover:text-destructive active:scale-[0.97]",
              large ? "min-h-[54px] text-base" : "min-h-9 text-[13px]",
            )}
          >
            Reject
            <span className="grid size-5 place-items-center rounded-full bg-foreground/[0.06] transition-transform duration-300 group-hover/rj:scale-110">
              <XMini className="size-3" />
            </span>
          </button>
        </div>
      )}

      {kind === "others" && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 font-semibold uppercase tracking-[0.08em] text-blue",
            large ? "text-[13px]" : "text-[11.5px]",
          )}
        >
          <span className="rime-live-dot size-1.5 rounded-full bg-current" />
          quorum reached — signing
        </div>
      )}

      {kind === "decided" && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 font-semibold uppercase tracking-[0.08em]",
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
