// Compact in-phone view of the in-flight ceremony — the progress a signer
// sees on their own device once quorum is reached and the money is moving.

import { cn } from "@/lib/utils";
import { CEREMONY_ORDER, stepLabel, truncMid } from "@/lib/rime";
import type { ActiveCeremony } from "@/hooks/use-rime-state";

export function CeremonyPanel({
  active,
  explorer,
  large = false,
}: {
  active: ActiveCeremony;
  explorer: string;
  large?: boolean;
}) {
  const total = CEREMONY_ORDER.length;
  const done = active.reached + 1;
  const failed = !!active.failed;
  const finished = active.finished;
  const title = failed ? "Ceremony failed" : finished ? "Funds moved" : "Ceremony live";
  const line = failed
    ? active.failed
    : active.latest
      ? stepLabel(active.latest.step)
      : "Preparing…";
  const pct = failed ? 100 : Math.round((Math.max(done, 0) / total) * 100);
  const txid = active.req?.txid;

  const tone = failed
    ? "border-destructive/40"
    : finished
      ? "border-success/40"
      : "border-primary/35";
  const titleTone = failed
    ? "text-destructive"
    : finished
      ? "text-success"
      : "text-primary";

  return (
    <div
      className={cn(
        "rime-rise rounded-xl border bg-primary/[0.04] p-3",
        large && "rounded-[18px] p-4",
        tone,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 font-semibold uppercase tracking-[0.14em]",
          large ? "text-[11px]" : "text-[10px]",
          titleTone,
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full bg-current",
            !failed && !finished && "rime-live-dot",
          )}
        />
        {title}
        {active.req ? ` · R#${active.req.id}` : ""}
      </div>

      <div
        className={cn(
          "mt-2",
          large ? "text-[14.5px]" : "text-xs",
          failed ? "text-destructive" : "text-foreground",
        )}
      >
        {line}
      </div>

      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full transition-[width] duration-500 ease-out",
            failed ? "bg-destructive" : "bg-gradient-to-r from-primary to-success",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {txid && (
        <a
          href={`${explorer}${encodeURIComponent(txid)}`}
          target="_blank"
          rel="noopener noreferrer"
          title={txid}
          className={cn(
            "mt-2 block truncate font-mono text-success hover:underline",
            large ? "text-[12px]" : "text-[10.5px]",
          )}
        >
          txid {truncMid(txid, 10, 8)}
        </a>
      )}
    </div>
  );
}
