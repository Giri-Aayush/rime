// The full-width pipeline pinned to the bottom of the dashboard: the live
// signing ceremony for the in-flight request, rendered as the animated
// checkmark cascade. Idle until two signers approve.

import { cn } from "@/lib/utils";
import { StepCascade } from "@/components/step-cascade";
import { CEREMONY_ORDER, STEP_SHORT, stepLabel, truncMid } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

export function CeremonyStrip({ rime }: { rime: RimeState }) {
  const active = rime.activeCeremony;
  const failed = !!active?.failed;
  const reached = active?.reached ?? -1;
  const finished = active?.finished ?? false;

  let tag: React.ReactNode;
  let title: React.ReactNode;
  let detail: React.ReactNode;

  if (!active) {
    tag = (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        Ceremony pipeline
      </span>
    );
    title = null;
    detail = (
      <span className="truncate text-xs text-muted-foreground">
        awaiting quorum — steps stream here live as two signers approve
      </span>
    );
  } else {
    const tone = failed
      ? "text-destructive"
      : finished
        ? "text-success"
        : "text-primary";
    tag = (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em]",
          tone,
        )}
      >
        {!failed && !finished && (
          <span className="rime-live-dot size-1.5 rounded-full bg-current" />
        )}
        {failed ? "Failed" : finished ? "Complete" : "Live"}
      </span>
    );
    title = (
      <span className="text-[12.5px] font-semibold text-foreground">
        R#{active.id}
        {active.req ? ` · ${active.req.reason}` : ""}
      </span>
    );
    detail = failed ? (
      <span className="truncate text-xs text-destructive">{active.failed}</span>
    ) : (
      <span className="truncate text-xs text-muted-foreground">
        {active.latest
          ? stepLabel(active.latest.step) +
            (active.latest.detail ? ` — ${active.latest.detail}` : "")
          : ""}
      </span>
    );
  }

  const txid = active?.req?.txid;

  return (
    <footer
      aria-label="Ceremony progress"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 px-7 pb-3.5 pt-3 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-[1664px] items-baseline gap-3.5">
        {tag}
        {title}
        {detail}
        {txid && (
          <a
            href={`${rime.explorer}${encodeURIComponent(txid)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 font-mono text-[11.5px] text-success hover:underline"
          >
            txid {truncMid(txid, 12, 10)} ↗
          </a>
        )}
      </div>
      <div className="mx-auto mt-2.5 max-w-[1664px]">
        <StepCascade
          order={CEREMONY_ORDER}
          labels={STEP_SHORT}
          reached={reached}
          active={!!active && !failed && !finished}
          failed={failed}
          finished={finished}
        />
      </div>
    </footer>
  );
}
