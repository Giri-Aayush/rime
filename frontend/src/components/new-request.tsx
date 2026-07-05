"use client";

// Compose a payment request. Recipient defaults to the treasury's own
// address (the self-pay demo) until the operator edits it; the amount field
// shows its zatoshi expansion live so there's no ambiguity about units.

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Bezel } from "@/components/bezel";
import { IslandButton } from "@/components/island-button";
import { SectionLabel } from "@/components/section-label";
import { toZatoshis } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

const fieldLabel =
  "mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";

const fieldInput =
  "h-11 rounded-xl border-border bg-background px-3.5 text-[13px] transition-colors focus-visible:border-primary/50";

export function NewRequest({ rime }: { rime: RimeState }) {
  const { treasury, unit, createRequest } = rime;
  const [recipient, setRecipient] = useState("");
  const [recipientDirty, setRecipientDirty] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Until the operator types their own, mirror the treasury address (the
  // self-pay demo). Derived — no effect needed.
  const recipientValue = recipientDirty ? recipient : (treasury?.address ?? "");

  const zat = toZatoshis(amount.trim());
  const zatHint =
    zat != null && zat > BigInt(0)
      ? `= ${Number(zat).toLocaleString("en-US")} zatoshis`
      : " ";

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitting(true);
    const ok = await createRequest({ recipient: recipientValue, amount, reason });
    setSubmitting(false);
    if (ok) {
      setAmount("");
      setReason("");
    }
  }

  return (
    <Bezel>
      <Card className="gap-0 rounded-[1.35rem] p-6">
        <SectionLabel className="mb-4" accent="violet">
          New request
        </SectionLabel>
        <form onSubmit={onSubmit} autoComplete="off">
          <label className="mb-4 block">
            <span className={fieldLabel}>Recipient</span>
            <Input
              className={`${fieldInput} font-mono`}
              value={recipientValue}
              spellCheck={false}
              placeholder="u1…"
              onChange={(e) => {
                setRecipient(e.target.value);
                setRecipientDirty(true);
              }}
            />
            <span className="mt-1.5 block min-h-3.5 text-[11px] text-muted-foreground/70">
              defaults to the treasury&rsquo;s own address — self-pay demo
            </span>
          </label>

          <label className="mb-4 block">
            <span className={fieldLabel}>
              Amount <span className="ml-1 text-primary">{unit}</span>
            </span>
            <Input
              className={`${fieldInput} font-mono`}
              value={amount}
              inputMode="decimal"
              placeholder="0.10000000"
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="mt-1.5 block min-h-3.5 font-mono text-[11px] text-muted-foreground/70">
              {zatHint}
            </span>
          </label>

          <label className="mb-1 block">
            <span className={fieldLabel}>Reason</span>
            <Input
              className={fieldInput}
              value={reason}
              maxLength={120}
              placeholder="Why is the treasury paying this?"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <div className="mt-5 flex items-center justify-end">
            <IslandButton type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create request"}
            </IslandButton>
          </div>
        </form>
      </Card>
    </Bezel>
  );
}
