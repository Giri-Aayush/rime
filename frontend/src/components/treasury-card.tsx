"use client";

// Treasury balance + the Orchard-only deposit address. There's no balance
// endpoint yet, so the figure is an em-dash with an honest caption. The
// address carries a guard note — depositing to a Sapling receiver would
// strand the funds.

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/section-label";
import type { RimeState } from "@/hooks/use-rime-state";

export function TreasuryCard({ rime }: { rime: RimeState }) {
  const { treasury, unit, threshold } = rime;
  const signerCount = treasury?.signers?.length ?? 3;
  const address = treasury?.address ?? "";
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
      <Card className="gap-3 p-5">
        <SectionLabel>Treasury balance</SectionLabel>
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[40px] font-medium leading-none tracking-tight text-foreground [text-shadow:0_0_30px_color-mix(in_oklab,var(--primary)_18%,transparent)]">
            —
          </span>
          <span className="font-mono text-sm tracking-[0.1em] text-primary">
            {unit}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground/70">
            awaiting first deposit
          </span>{" "}
          — no single person can move these funds; any{" "}
          <strong className="font-semibold text-primary">
            {threshold} of {signerCount}
          </strong>{" "}
          signers must approve.
        </p>
      </Card>

      <Card className="gap-3 p-5">
        <SectionLabel>Deposit address · Orchard</SectionLabel>
        <div className="flex items-center gap-2.5">
          <code
            className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-primary"
            title={address}
          >
            {address || "—"}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyAddress}
            className={
              copied ? "shrink-0 border-success/45 text-success" : "shrink-0"
            }
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
          Orchard receiver only — Sapling deposits would be unspendable.
        </p>
      </Card>
    </>
  );
}
