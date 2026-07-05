// Append-only audit trail, collapsed by default. A native <details> keeps it
// zero-JS and static-export safe; the chevron rotates on open.

import { ChevronDownIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { clock } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

export function AuditLog({ rime }: { rime: RimeState }) {
  const rows = [...rime.audit].reverse(); // newest first

  return (
    <Card className="gap-0 p-5">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Audit log
          </span>
          <span className="rounded-full border border-primary/30 px-2 font-mono text-[10px] text-primary">
            {rows.length}
          </span>
          <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground/70 transition-transform group-open:rotate-180" />
        </summary>

        <div className="mt-3.5 flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-1.5 text-[12.5px] text-muted-foreground/70">
              Nothing logged yet.
            </p>
          ) : (
            rows.map((a, i) => (
              <div
                key={i}
                className="grid grid-cols-[62px_130px_1fr] items-baseline gap-2.5 rounded-md px-1.5 py-1 text-[11.5px] odd:bg-primary/[0.025]"
              >
                <span className="font-mono text-[10.5px] text-muted-foreground/70">
                  {clock(a.at)}
                </span>
                <span
                  className="truncate font-mono text-[10.5px] tracking-[0.05em] text-primary"
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
  );
}
