// Dashboard header: the Rime wordmark (the one place the editorial serif is
// allowed), network + threshold badges, and the live SSE connection dot.

import { cn } from "@/lib/utils";
import { ConnDot } from "@/components/conn-dot";
import type { RimeState } from "@/hooks/use-rime-state";

function MetaBadge({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em]",
        accent
          ? "border-primary/30 text-primary"
          : "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function HeaderBar({ rime }: { rime: RimeState }) {
  const { treasury, threshold, sse } = rime;
  const signerCount = treasury?.signers?.length ?? 3;
  const network = treasury?.network ?? "—";

  return (
    <header className="flex flex-wrap items-center justify-between gap-6 border-b border-border px-7 py-[18px]">
      <div className="flex items-center gap-3.5">
        <span
          className="text-2xl leading-none text-primary [filter:drop-shadow(0_0_14px_color-mix(in_oklab,var(--primary)_45%,transparent))]"
          aria-hidden="true"
        >
          ❄
        </span>
        <div>
          <h1 className="font-serif text-[28px] leading-none tracking-tight text-foreground">
            Rime
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
            frost-sealed treasury for teams
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <MetaBadge>network {network}</MetaBadge>
        <MetaBadge accent>
          {threshold}-of-{signerCount} · FROST
        </MetaBadge>
        <ConnDot status={sse} className="pl-2" />
      </div>
    </header>
  );
}
