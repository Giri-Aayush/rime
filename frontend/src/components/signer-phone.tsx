// One signer's phone, framed in a CSS bezel (desktop right column). Shows a
// status chip and the signer's live approval queue. When quorum lands, the
// ceremony progress appears here too. A lost device freezes over red; the
// other signers thaw it back — the demo's centerpiece.

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SignerAvatar } from "@/components/signer-avatar";
import { ApprovalCard } from "@/components/approval-card";
import { CeremonyPanel } from "@/components/ceremony-panel";
import { RecoveryPanel } from "@/components/recovery-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BigTick } from "@/components/tick-icons";
import type { SignerConfig } from "@/lib/rime";
import { SIGNERS } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

function StatusChip({ status }: { status: "active" | "lost" | "repairing" }) {
  const map = {
    active: "border-success/35 bg-success/[0.06] text-success",
    lost: "border-destructive/50 bg-destructive/10 text-destructive",
    repairing: "border-primary/45 bg-primary/10 text-primary",
  } as const;
  const label = { active: "Active", lost: "Lost", repairing: "Repairing" }[status];
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em]",
        map[status],
      )}
    >
      {label}
    </span>
  );
}

export function SignerPhone({
  rime,
  signer,
  index,
}: {
  rime: RimeState;
  signer: SignerConfig;
  index: number;
}) {
  const name = rime.signerName(index);
  const st = rime.signerStatus(signer.id);
  const reviving = rime.isReviving(signer.id);
  const lost = st === "lost";
  const repairing = st === "repairing";
  const down = (lost || repairing) && !reviving;

  const q = rime.phoneQueue(signer.id);
  const pending = q.open.length;

  const frameTone = reviving
    ? "rime-thaw border-success/40"
    : repairing
      ? "border-primary/30"
      : down
        ? "border-destructive/30 from-destructive/[0.05]"
        : "border-border";

  const chipStatus: "active" | "lost" | "repairing" = repairing
    ? "repairing"
    : lost && !reviving
      ? "lost"
      : "active";

  return (
    <div
      aria-label={`${name}'s phone`}
      className={cn(
        "relative flex min-h-[560px] flex-col rounded-[34px] border bg-gradient-to-b from-card to-background p-3.5 pb-[18px]",
        "shadow-[inset_0_0_0_5px_var(--background),inset_0_0_0_6px_var(--border),0_18px_40px_-20px_rgba(0,0,0,0.9)]",
        frameTone,
      )}
    >
      {/* notch */}
      <div className="mx-auto mb-3 mt-1 h-[15px] w-[74px] shrink-0 rounded-full border border-border bg-background" />

      {/* head */}
      <div className="mb-3 flex items-center gap-2.5 border-b border-border px-2 pb-3">
        <SignerAvatar hue={signer.hue} name={name} muted={down} />
        <div className="min-w-0">
          <div
            className={cn(
              "text-[15px] font-semibold",
              down && "text-muted-foreground",
            )}
          >
            {name}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            signer {index + 1} of {SIGNERS.length}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
          <StatusChip status={chipStatus} />
          {!down && !reviving && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[10px]",
                pending
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground/70",
              )}
            >
              {pending} pending
            </span>
          )}
        </div>
      </div>

      {/* screen */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-0.5 pb-0.5">
        {down || reviving ? (
          <LostScreen rime={rime} signer={signer} name={name} reviving={reviving} repairing={repairing} />
        ) : (
          <PhoneQueue rime={rime} signer={signer} />
        )}
      </div>

      {/* footer: report lost */}
      {!down && !reviving && (
        <div className="flex shrink-0 justify-center pb-0.5 pt-2">
          <ConfirmDialog
            title={`Report ${name}'s device as lost?`}
            description="The other two signers will rebuild the share. The treasury address does not change."
            confirmLabel="Report lost"
            destructive
            onConfirm={() => rime.markLost(signer.id)}
            trigger={
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[10.5px] tracking-[0.08em] text-muted-foreground/70 transition-colors hover:bg-destructive/[0.06] hover:text-destructive"
              >
                Report device lost
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}

function PhoneQueue({ rime, signer }: { rime: RimeState; signer: SignerConfig }) {
  const q = rime.phoneQueue(signer.id);
  const { activeCeremony, threshold, unit, explorer } = rime;
  const hasCards =
    activeCeremony || q.open.length || q.others.length || q.decided.length;

  if (!hasCards) {
    return (
      <div className="grid flex-1 place-items-center px-3 py-6 text-center text-xs text-muted-foreground/70">
        <div>
          <span className="mb-2 block font-mono text-xl text-primary/35">✻</span>
          No pending approvals
          <br />
          All quiet on the ice.
        </div>
      </div>
    );
  }

  return (
    <>
      {activeCeremony && (
        <CeremonyPanel active={activeCeremony} explorer={explorer} />
      )}
      {q.open.map((r) => (
        <ApprovalCard
          key={`o${r.id}`}
          req={r}
          kind="open"
          threshold={threshold}
          unit={unit}
          onApprove={() => rime.decide(signer.id, r.id, "approve")}
          onReject={() => rime.decide(signer.id, r.id, "reject")}
        />
      ))}
      {q.others.map((r) => (
        <ApprovalCard key={`w${r.id}`} req={r} kind="others" threshold={threshold} unit={unit} />
      ))}
      {q.decided.map((r) => (
        <ApprovalCard
          key={`d${r.id}`}
          req={r}
          kind="decided"
          decision={rime.myDecision(signer.id, r.id)}
          threshold={threshold}
          unit={unit}
        />
      ))}
    </>
  );
}

function LostScreen({
  rime,
  signer,
  name,
  reviving,
  repairing,
}: {
  rime: RimeState;
  signer: SignerConfig;
  name: string;
  reviving: boolean;
  repairing: boolean;
}) {
  if (reviving) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-2.5 py-6 text-center">
        <span className="text-success">
          <BigTick />
        </span>
        <div className="text-[15px] font-semibold text-success">Share restored</div>
        <div className="max-w-[28ch] text-xs leading-relaxed text-muted-foreground">
          Treasury address unchanged — {name} can approve again.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-2 px-2 pb-2 pt-5 text-center">
      <div className="rime-flicker text-[38px] leading-none text-destructive/55 [filter:drop-shadow(0_0_16px_color-mix(in_oklab,var(--destructive)_35%,transparent))]">
        ❄
      </div>
      <div className="text-sm font-semibold tracking-[0.04em] text-destructive">
        Device share lost
      </div>
      <div className="mb-1.5 max-w-[30ch] text-xs leading-relaxed text-muted-foreground">
        {name}&rsquo;s key share is gone. Funds stay safe — the other two signers
        can rebuild it. Nothing moves without {rime.threshold} approvals.
      </div>
      {repairing ? (
        <RecoveryPanel rec={rime.recoveryFor(signer.id)} />
      ) : (
        <Button
          type="button"
          onClick={() => rime.repair(signer.id)}
          className="mt-1 px-4.5 py-2.5 text-[12.5px] tracking-[0.04em] shadow-[0_0_22px_-6px_var(--primary)]"
        >
          Repair from other signers
        </Button>
      )}
    </div>
  );
}
