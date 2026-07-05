"use client";

// Treasury balance + the Orchard-only deposit address. Balance comes from the
// watch-only wallet via /api/balance; until the first deposit lands it reads
// 0. The address carries a guard note — depositing to a Sapling receiver would
// strand the funds.

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Bezel } from "@/components/bezel";
import { SectionLabel } from "@/components/section-label";
import type { RimeState } from "@/hooks/use-rime-state";

// zatoshis → a trimmed decimal string (no trailing-zero noise, but never bare).
function fmtBalance(zat: number): string {
  const s = (zat / 100_000_000).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}

export function TreasuryCard({ rime }: { rime: RimeState }) {
  const { treasury, balance, unit, threshold } = rime;
  const signerCount = treasury?.signers?.length ?? 3;
  const address = treasury?.address ?? "";
  const funded = !!balance && balance.total_zat > 0;
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!address) {
      toast.error("Address not available yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = address;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Bezel tone="mint">
        <Card className="gap-4 rounded-[1.35rem] p-6">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel accent="mint">Treasury balance</SectionLabel>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
              {funded ? "shielded · orchard" : "awaiting deposit"}
            </span>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[58px] font-medium leading-[0.85] tracking-[-0.03em] text-foreground tabular-nums [text-shadow:0_0_36px_color-mix(in_oklab,var(--primary)_20%,transparent)]">
              {balance ? fmtBalance(balance.total_zat) : "—"}
            </span>
            <span className="font-mono text-sm tracking-[0.14em] text-primary">
              {unit}
            </span>
          </div>

          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            No single person can move these funds — any{" "}
            <strong className="font-semibold text-primary">
              {threshold} of {signerCount}
            </strong>{" "}
            signers must approve.
          </p>
        </Card>
      </Bezel>

      <Bezel>
        <Card className="gap-3.5 rounded-[1.35rem] p-6">
          <SectionLabel accent="blue">Deposit address · Orchard</SectionLabel>
          <div className="flex items-center gap-2.5">
            <code
              className="min-w-0 flex-1 truncate rounded-full border border-border bg-background px-4 py-2.5 font-mono text-xs text-primary"
              title={address}
            >
              {address || "—"}
            </code>
            <button
              type="button"
              onClick={copyAddress}
              className={cn_copy(copied)}
            >
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
            Orchard receiver only — Sapling deposits would be unspendable.
          </p>
        </Card>
      </Bezel>
    </>
  );
}

// The copy pill — rounded, mono, flips to a success tone on success.
function cn_copy(copied: boolean): string {
  return [
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.96]",
    copied
      ? "border-success/45 bg-success/10 text-success"
      : "border-border bg-secondary text-foreground hover:bg-accent",
  ].join(" ");
}
