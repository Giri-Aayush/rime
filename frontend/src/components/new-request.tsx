"use client";

// Compose a payment request. Recipient defaults to the treasury's own
// address (the self-pay demo) until the operator edits it; the amount field
// shows its zatoshi expansion live so there's no ambiguity about units.

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/section-label";
import { toZatoshis } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

const fieldLabel =
  "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

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
      : " ";

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
    <Card className="gap-0 p-5">
      <SectionLabel className="mb-3.5">New request</SectionLabel>
      <form onSubmit={onSubmit} autoComplete="off">
        <label className="mb-3.5 block">
          <span className={fieldLabel}>Recipient</span>
          <Input
            className="font-mono text-[12.5px]"
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

        <label className="mb-3.5 block">
          <span className={fieldLabel}>
            Amount <span className="ml-1 text-primary">{unit}</span>
          </span>
          <Input
            className="font-mono text-[12.5px]"
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
            value={reason}
            maxLength={120}
            placeholder="Why is the treasury paying this?"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        <div className="mt-3 flex items-center justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create request"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
