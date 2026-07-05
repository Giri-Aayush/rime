// The full-width pipeline pinned to the bottom of the dashboard: the live
// signing ceremony for the in-flight request, rendered as the animated
// checkmark cascade — a routed pipeline echoing the RouteLines motif. Idle
// until two signers approve.

import { cn } from "@/lib/utils";
import { StepCascade } from "@/components/step-cascade";
import { CEREMONY_ORDER, STEP_SHORT, stepLabel, truncMid } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

function Tag({
  tone,
  live,
  children,
}: {
  tone: string;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
        tone,
      )}
    >
      {live && <span className="rime-live-dot size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

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
      <Tag tone="border-border bg-foreground/2 text-muted-foreground/70">
        Ceremony pipeline
      </Tag>
    );
    title = null;
    detail = (
      <span className="truncate text-xs text-muted-foreground">
        awaiting quorum — steps stream here live as two signers approve
      </span>
    );
  } else {
    const tone = failed
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : finished
        ? "border-success/40 bg-success/10 text-success"
        : "border-blue/40 bg-blue/10 text-blue";
    tag = (
      <Tag tone={tone} live={!failed && !finished}>
        {failed ? "Failed" : finished ? "Complete" : "Live"}
      </Tag>
    );
    title = (
      <span className="shrink-0 text-[12.5px] font-semibold text-foreground">
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 px-7 pb-4 pt-3.5 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-[1720px] items-center gap-3.5">
        {tag}
        {title}
        {detail}
        {txid && (
          <a
            href={`${rime.explorer}${encodeURIComponent(txid)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 rounded-full border border-success/30 bg-success/[0.06] px-3 py-1 font-mono text-[11.5px] text-success transition-colors hover:border-success/60"
          >
            txid {truncMid(txid, 12, 10)} ↗
          </a>
        )}
      </div>
      <div className="mx-auto mt-3 max-w-[1720px]">
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
