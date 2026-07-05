// The treasury's payment requests, newest first. Each row carries a status
// chip, quorum meter, and — on the terminal states — either the on-chain
// txid (linked to the explorer) or the failure reason in destructive red.

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/section-label";
import { StatusChip } from "@/components/status-chip";
import { QuorumMeter } from "@/components/quorum-meter";
import { fmtZat, timeAgo, truncMid } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

export function RequestFeed({ rime }: { rime: RimeState }) {
  const { requests, threshold, unit, explorer, failureDetail } = rime;

  return (
    <Card className="gap-3 p-5">
      <SectionLabel>Payment requests</SectionLabel>
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
                className="rime-rise rounded-[10px] border border-border bg-background p-3.5"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2.5">
                  <span className="text-[13.5px] font-semibold">
                    <span className="mr-2 font-mono text-[11px] text-muted-foreground/70">
                      R#{r.id}
                    </span>
                    {r.reason}
                  </span>
                  <StatusChip status={r.status} />
                </div>

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono text-[12.5px] text-foreground">
                    {fmtZat(r.amount_zat)}
                    <span className="ml-0.5 text-[11px] text-primary">{unit}</span>
                  </span>
                  <span
                    className="font-mono text-[11.5px] text-muted-foreground/70"
                    title={r.recipient}
                  >
                    → {truncMid(r.recipient)}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground/70">
                    {timeAgo(r.created_at)}
                  </span>
                </div>

                <QuorumMeter req={r} threshold={threshold} className="mt-2.5" />

                {r.txid && (
                  <a
                    href={`${explorer}${encodeURIComponent(r.txid)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={r.txid}
                    className="mt-2.5 block truncate rounded-lg border border-success/30 bg-success/[0.06] px-2.5 py-2 font-mono text-[11.5px] text-success hover:border-success/60"
                  >
                    <span className="mr-2 text-[9.5px] uppercase tracking-[0.14em] text-success/70">
                      txid
                    </span>
                    {r.txid}
                  </a>
                )}

                {fail && (
                  <div className="mt-2.5 rounded-lg border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                    {fail}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
