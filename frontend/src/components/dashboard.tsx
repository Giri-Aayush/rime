// Desktop dashboard composition: treasury column (~40%) beside the three
// signer phones (~60%), with the live ceremony pipeline pinned to the bottom.

import { HeaderBar } from "@/components/header-bar";
import { TreasuryCard } from "@/components/treasury-card";
import { NewRequest } from "@/components/new-request";
import { RequestFeed } from "@/components/request-feed";
import { AuditLog } from "@/components/audit-log";
import { SignerPhone } from "@/components/signer-phone";
import { CeremonyStrip } from "@/components/ceremony-strip";
import { SectionLabel } from "@/components/section-label";
import { SIGNERS } from "@/lib/rime";
import type { RimeState } from "@/hooks/use-rime-state";

export function Dashboard({ rime }: { rime: RimeState }) {
  return (
    <>
      <HeaderBar rime={rime} />

      <main className="mx-auto grid w-full max-w-[1720px] grid-cols-1 items-start gap-[22px] px-7 pb-[160px] pt-[22px] xl:grid-cols-[minmax(400px,2fr)_3fr]">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Treasury">
          <TreasuryCard rime={rime} />
          <NewRequest rime={rime} />
          <RequestFeed rime={rime} />
          <AuditLog rime={rime} />
        </section>

        <section className="min-w-0" aria-label="Signers">
          <div className="mb-3.5 flex flex-wrap items-baseline gap-3.5 px-1">
            <SectionLabel>Signers</SectionLabel>
            <span className="text-xs italic text-muted-foreground/70">
              three people hold key shares — any two approvals move funds
            </span>
          </div>
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-3">
            {SIGNERS.map((s, i) => (
              <SignerPhone key={s.id} rime={rime} signer={s} index={i} />
            ))}
          </div>
        </section>
      </main>

      <CeremonyStrip rime={rime} />
    </>
  );
}
