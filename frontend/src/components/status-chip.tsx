// Request status pill — the wavelength "tagged data row" move. Each state maps
// to exactly one candy accent so the feed reads like a color-coded ledger:
// pending → lavender, quorum/signing → electric blue (signing is the live one,
// it glows), broadcast → mint, failed → destructive, rejected → muted.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RequestStatus } from "@/lib/types";

const STYLES: Record<string, string> = {
  pending: "border-violet/25 bg-violet/10 text-violet",
  quorum: "border-blue/30 bg-blue/10 text-blue",
  signing: "border-blue/40 bg-blue/10 text-blue rime-chip-glow",
  broadcast: "border-success/35 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  rejected: "border-border bg-muted/40 text-muted-foreground",
};

export function StatusChip({
  status,
  className,
}: {
  status: RequestStatus | string;
  className?: string;
}) {
  const cls = STYLES[status] ?? STYLES.pending;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]",
        cls,
        className,
      )}
    >
      <span className="size-1 rounded-full bg-current" aria-hidden="true" />
      {status}
    </Badge>
  );
}
