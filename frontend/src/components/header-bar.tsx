// Dashboard hero: the Rime wordmark (the one place the editorial serif is
// allowed), an eyebrow tag, the signing-route motif drifting behind it, and
// the network / threshold / SSE meta rendered as small mono pills.

import { cn } from "@/lib/utils";
import { ConnDot } from "@/components/conn-dot";
import { RouteLines } from "@/components/route-lines";
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-foreground/2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] backdrop-blur-sm",
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
    <header className="relative isolate overflow-hidden border-b border-border">
      <RouteLines className="opacity-70 [mask-image:linear-gradient(to_bottom,black_20%,transparent)]" />

      <div className="relative mx-auto flex max-w-[1720px] flex-wrap items-end justify-between gap-8 px-7 pb-9 pt-10">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/90">
            <span className="size-1 rounded-full bg-primary" aria-hidden="true" />
            Threshold treasury
          </div>

          <div className="mt-3 flex items-center gap-3.5">
            <span
              className="text-[38px] leading-none text-primary [filter:drop-shadow(0_0_20px_color-mix(in_oklab,var(--primary)_50%,transparent))]"
              aria-hidden="true"
            >
              ❄
            </span>
            <h1 className="font-serif text-[64px] leading-[0.9] tracking-[-0.02em] text-foreground">
              Rime
            </h1>
          </div>

          <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
            A frost-sealed treasury for teams — no single person can move the
            money, any two signatures can.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <MetaBadge>network {network}</MetaBadge>
          <MetaBadge accent>
            {threshold}-of-{signerCount} · FROST
          </MetaBadge>
          <ConnDot status={sse} />
        </div>
      </div>
    </header>
  );
}
