"use client";

// Device mode (?signer=alice|bob|carol): the physical phone IS the bezel, so
// this is a full-viewport, bezel-less signer view with big touch targets.
// Three states: normal approval queue, a full-screen "share lost — recovering"
// panel, and a brief "Restored ✓" celebration. Carries the signer's candy
// identity (Alice=violet, Bob=mint, Carol=blue).

import { cn } from "@/lib/utils";
import { SignerAvatar } from "@/components/signer-avatar";
import { ConnDot } from "@/components/conn-dot";
import { ApprovalCard } from "@/components/approval-card";
import { CeremonyPanel } from "@/components/ceremony-panel";
import { RecoveryPanel } from "@/components/recovery-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BigTick } from "@/components/tick-icons";
import { SIGNER_ACCENT } from "@/components/signer-identity";
import { SIGNERS } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

function DeviceHead({
  rime,
  name,
  hue,
  me,
  muted = false,
}: {
  rime: RimeState;
  name: string;
  hue: "a" | "b" | "c";
  me: number;
  muted?: boolean;
}) {
  const accent = SIGNER_ACCENT[hue];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b px-0.5 pb-4 pt-2",
        muted ? "border-border" : accent.border,
      )}
    >
      <SignerAvatar hue={hue} name={name} size="lg" muted={muted} />
      <div className="min-w-0">
        <div className={cn("text-[22px] font-semibold leading-tight", !muted && accent.text)}>
          {name}
        </div>
        <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
          Rime treasury · signer {me + 1} of {SIGNERS.length}
        </div>
      </div>
      <ConnDot status={rime.sse} className="ml-auto shrink-0" />
    </div>
  );
}

export function DeviceView({ rime }: { rime: RimeState }) {
  const me = rime.me ?? 0;
  const signer = SIGNERS[me];
  const name = rime.signerName(me);
  const st = rime.signerStatus(signer.id);
  const reviving = rime.isReviving(signer.id);
  const down = (st === "lost" || st === "repairing") && !reviving;
  const accent = SIGNER_ACCENT[signer.hue];

  return (
    <div
      className={cn(
        "relative mx-auto flex min-h-dvh w-full max-w-[620px] flex-col overflow-x-hidden",
        "px-[max(18px,env(safe-area-inset-left))] pb-[max(8px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]",
      )}
    >
      {/* per-signer / lost color-block wash bleeding from the top */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 -z-10 h-52",
          down ? "bg-gradient-to-b from-destructive/[0.08] to-transparent" : accent.block,
        )}
      />

      {reviving ? (
        <>
          <DeviceHead rime={rime} name={name} hue={signer.hue} me={me} />
          <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-5 text-center">
            <span className="text-success">
              <BigTick className="size-[92px]" />
            </span>
            <div className="text-[30px] font-semibold tracking-[0.02em] text-success [text-shadow:0_0_30px_color-mix(in_oklab,var(--success)_40%,transparent)]">
              Restored ✓
            </div>
            <div className="text-sm leading-relaxed text-muted-foreground">
              Share rebuilt · treasury address unchanged.
              <br />
              You can approve payments again.
            </div>
          </div>
          <DeviceFoot />
        </>
      ) : down ? (
        <>
          <DeviceHead rime={rime} name={name} hue={signer.hue} me={me} muted />
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
            <div className="rime-flicker text-[62px] leading-none text-destructive/60 [filter:drop-shadow(0_0_26px_color-mix(in_oklab,var(--destructive)_40%,transparent))]">
              ❄
            </div>
            <div className="text-[21px] font-semibold leading-tight text-destructive">
              This device&rsquo;s share was lost
            </div>
            <div className="max-w-[32ch] text-sm leading-relaxed text-muted-foreground">
              Recovering from the other two signers — your treasury is safe.
            </div>
            <RecoveryPanel rec={rime.recoveryFor(signer.id)} size="lg" />
            <div className="mt-1 max-w-[34ch] text-xs leading-relaxed text-muted-foreground/70">
              The old share is being retired as a dead key. When recovery
              finishes you&rsquo;ll be able to approve again.
            </div>
          </div>
          <DeviceFoot />
        </>
      ) : (
        <NormalDevice rime={rime} me={me} name={name} hue={signer.hue} />
      )}
    </div>
  );
}

function NormalDevice({
  rime,
  me,
  name,
  hue,
}: {
  rime: RimeState;
  me: number;
  name: string;
  hue: "a" | "b" | "c";
}) {
  const signer = SIGNERS[me];
  const accent = SIGNER_ACCENT[hue];
  const q = rime.phoneQueue(signer.id);
  const { activeCeremony, threshold, unit, explorer } = rime;
  const count = q.open.length;
  const hasCards =
    activeCeremony || q.open.length || q.others.length || q.decided.length;

  return (
    <>
      <DeviceHead rime={rime} name={name} hue={hue} me={me} />
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-0.5 py-4">
        {count > 0 && (
          <div
            className={cn(
              "flex items-center gap-2 px-0.5 text-xs font-bold uppercase tracking-[0.16em]",
              accent.text,
            )}
          >
            <span className={cn("size-1.5 rounded-full", accent.dot)} />
            {count} request{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""}{" "}
            your approval
          </div>
        )}
        {!hasCards ? (
          <div className="grid flex-1 place-items-center px-3 py-6 text-center text-sm text-muted-foreground/70">
            <div>
              <span className="mb-2 block font-mono text-2xl text-primary/35">✻</span>
              No pending approvals
              <br />
              All quiet on the ice.
            </div>
          </div>
        ) : (
          <>
            {activeCeremony && (
              <CeremonyPanel active={activeCeremony} explorer={explorer} large />
            )}
            {q.open.map((r) => (
              <ApprovalCard
                key={`o${r.id}`}
                req={r}
                kind="open"
                large
                threshold={threshold}
                unit={unit}
                onApprove={() => rime.decide(signer.id, r.id, "approve")}
                onReject={() => rime.decide(signer.id, r.id, "reject")}
              />
            ))}
            {q.others.map((r) => (
              <ApprovalCard
                key={`w${r.id}`}
                req={r}
                kind="others"
                large
                threshold={threshold}
                unit={unit}
              />
            ))}
            {q.decided.map((r) => (
              <ApprovalCard
                key={`d${r.id}`}
                req={r}
                kind="decided"
                large
                decision={rime.myDecision(signer.id, r.id)}
                threshold={threshold}
                unit={unit}
              />
            ))}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-0.5 pb-1 pt-3">
        <ConfirmDialog
          title={`Report ${name}'s device as lost?`}
          description="The other two signers will rebuild the share. The treasury address does not change."
          confirmLabel="Report lost"
          destructive
          onConfirm={() => rime.markLost(signer.id)}
          trigger={
            <button
              type="button"
              className="min-h-10 rounded-full border border-border px-4 py-2 text-xs tracking-[0.06em] text-muted-foreground/70 transition-colors active:border-destructive/40 active:text-destructive"
            >
              Report this device lost
            </button>
          }
        />
        <span className="ml-auto font-mono text-[10.5px] tracking-[0.1em] text-muted-foreground/70">
          ❄ Rime · {rime.threshold}-of-{SIGNERS.length} FROST
        </span>
      </div>
    </>
  );
}

function DeviceFoot() {
  return (
    <div className="flex shrink-0 items-center border-t border-border px-0.5 pb-1 pt-3">
      <span className="ml-auto font-mono text-[10.5px] tracking-[0.1em] text-muted-foreground/70">
        ❄ Rime · share recovery
      </span>
    </div>
  );
}
