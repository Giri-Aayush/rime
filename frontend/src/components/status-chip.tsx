// Request status pill. Color is scarce here — each state gets exactly one
// accent, and only `signing` animates (it's the live one).

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RequestStatus } from "@/lib/types";

const STYLES: Record<string, string> = {
  pending: "border-border bg-muted/40 text-muted-foreground",
  quorum: "border-primary/40 bg-primary/10 text-primary",
  signing: "border-primary/50 bg-primary/10 text-primary rime-chip-glow",
  broadcast: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  rejected: "border-destructive/25 bg-destructive/5 text-destructive/70",
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
        "border font-mono text-[10px] font-semibold uppercase tracking-[0.12em]",
        cls,
        className,
      )}
    >
      {status}
    </Badge>
  );
}
