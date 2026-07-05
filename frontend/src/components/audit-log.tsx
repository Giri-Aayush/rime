// Append-only audit trail, collapsed by default. A native <details> keeps it
// zero-JS and static-export safe; the chevron rotates on open.

import { ChevronDownIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Bezel } from "@/components/bezel";
import { clock } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

export function AuditLog({ rime }: { rime: RimeState }) {
  const rows = [...rime.audit].reverse(); // newest first

  return (
    <Bezel>
      <Card className="gap-0 rounded-[1.35rem] p-6">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-foreground/2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <span className="size-1 rounded-full bg-muted-foreground/50" aria-hidden="true" />
              Audit log
            </span>
            <span className="rounded-full border border-primary/30 px-2 py-0.5 font-mono text-[10px] text-primary">
              {rows.length}
            </span>
            <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground/70 transition-transform duration-300 group-open:rotate-180" />
          </summary>

          <div className="mt-4 flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="py-1.5 text-[12.5px] text-muted-foreground/70">
                Nothing logged yet.
              </p>
            ) : (
              rows.map((a, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[62px_130px_1fr] items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-[11.5px] odd:bg-foreground/[0.02]"
                >
                  <span className="font-mono text-[10.5px] text-muted-foreground/60">
                    {clock(a.at)}
                  </span>
                  <span
                    className="truncate font-mono text-[10.5px] tracking-[0.04em] text-primary"
                    title={a.event}
                  >
                    {a.event}
                  </span>
                  <span className="break-words text-muted-foreground">
                    {a.detail}
                  </span>
                </div>
              ))
            )}
          </div>
        </details>
      </Card>
    </Bezel>
  );
}
