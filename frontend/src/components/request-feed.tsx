// The treasury's payment requests, newest first. Each row carries a status
// chip, quorum meter, and — on the terminal states — either the on-chain
// txid (linked to the explorer) or the failure reason in destructive red.
// Styled as wavelength's color-tagged data rows.

import { Card } from "@/components/ui/card";
import { Bezel } from "@/components/bezel";
import { SectionLabel } from "@/components/section-label";
import { StatusChip } from "@/components/status-chip";
import { QuorumMeter } from "@/components/quorum-meter";
import { ArrowUpRight } from "@/components/island-button";
import { fmtZat, timeAgo, truncMid } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

export function RequestFeed({ rime }: { rime: RimeState }) {
  const { requests, threshold, unit, explorer, failureDetail } = rime;

  return (
    <Bezel>
      <Card className="gap-4 rounded-[1.35rem] p-6">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Payment requests</SectionLabel>
          <span className="font-mono text-[11px] text-muted-foreground/70">
            {requests.length}
          </span>
        </div>
        {requests.length === 0 ? (
          <p className="py-1.5 text-[12.5px] text-muted-foreground/70">
            No requests yet — create one above.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {requests.map((r) => {
              const cf = failureDetail(r.id);
              const fail =
                r.status === "failed"
                  ? cf || "Ceremony failed — see audit log"
                  : cf;
              return (
                <article
                  key={r.id}
                  className="rime-rise rounded-2xl border border-border bg-background/60 p-4 transition-colors duration-300 hover:border-border/80"
                >
                  <div className="mb-2 flex items-center justify-between gap-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
                      <span className="shrink-0 rounded-md bg-foreground/5 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                        R#{r.id}
                      </span>
                      <span className="truncate">{r.reason}</span>
                    </span>
                    <StatusChip status={r.status} />
                  </div>

                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono text-[15px] tracking-tight text-foreground tabular-nums">
                      {fmtZat(r.amount_zat)}
                      <span className="ml-1 text-[11px] text-primary">{unit}</span>
                    </span>
                    <span
                      className="font-mono text-[11.5px] text-muted-foreground/70"
                      title={r.recipient}
                    >
                      → {truncMid(r.recipient)}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">
                      {timeAgo(r.created_at)}
                    </span>
                  </div>

                  <QuorumMeter req={r} threshold={threshold} className="mt-3" />

                  {r.txid && (
                    <a
                      href={`${explorer}${encodeURIComponent(r.txid)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={r.txid}
                      className="group/txid mt-3 flex items-center gap-2 truncate rounded-full border border-success/30 bg-success/[0.06] px-3 py-2 font-mono text-[11.5px] text-success transition-colors hover:border-success/60"
                    >
                      <span className="shrink-0 text-[9.5px] uppercase tracking-[0.16em] text-success/70">
                        txid
                      </span>
                      <span className="truncate">{r.txid}</span>
                      <ArrowUpRight className="ml-auto size-3 shrink-0 transition-transform duration-300 group-hover/txid:translate-x-0.5 group-hover/txid:-translate-y-px" />
                    </a>
                  )}

                  {fail && (
                    <div className="mt-3 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {fail}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Card>
    </Bezel>
  );
}
