// The repair progress cascade — the animated payoff of the "lake scene".
// Reuses the ceremony step cascade with the recovery pipeline. Shown inside a
// frozen phone frame (sm) or the full device-lost screen (lg).

import { cn } from "@/lib/utils";
import { StepCascade } from "@/components/step-cascade";
import { RECOVERY_ORDER, RECOVERY_SHORT, stepLabel } from "@/lib/rime";

export interface RecoveryInfo {
  reached: number;
  step: string | null;
  failed: string | null;
  done: boolean;
}

export function RecoveryPanel({
  rec,
  size = "sm",
}: {
  rec: RecoveryInfo | null;
  size?: "sm" | "lg";
}) {
  const active = !!rec;
  const reached = rec?.reached ?? -1;
  const failed = rec?.failed ?? null;
  const done = rec?.done ?? false;

  const title = failed
    ? "Recovery failed"
    : done
      ? "Signer restored"
      : "Recovery in progress";
  const line = failed
    ? failed
    : active && rec?.step
      ? stepLabel(rec.step)
      : "Rebuilding the share from the other two signers…";

  const tone = failed
    ? "border-destructive/45"
    : done
      ? "border-success/45"
      : "border-primary/35";
  const titleTone = failed
    ? "text-destructive"
    : done
      ? "text-success"
      : "text-primary";

  return (
    <div
      className={cn(
        "rime-rise w-full rounded-2xl border bg-primary/[0.05] p-3.5 text-left",
        size === "lg" && "mt-2 rounded-[20px] p-4",
        tone,
      )}
    >
      <div
        className={cn(
          "mb-1.5 flex items-center gap-2 font-semibold uppercase tracking-[0.14em]",
          size === "lg" ? "text-[11px]" : "text-[10px]",
          titleTone,
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full bg-current",
            !failed && !done && "rime-live-dot",
          )}
        />
        {title}
      </div>
      <div
        className={cn(
          "mb-3 leading-snug",
          size === "lg" ? "text-[14px]" : "text-xs",
          failed ? "text-destructive" : "text-foreground",
        )}
      >
        {line}
      </div>
      <StepCascade
        order={RECOVERY_ORDER}
        labels={RECOVERY_SHORT}
        reached={reached}
        active={active && !done && !failed}
        failed={!!failed}
        finished={done}
        size="sm"
      />
    </div>
  );
}
