"use client";

// Single-page Rime UI. Reads ?signer from the URL (Suspense-wrapped, as the
// static export requires) and branches: no param → the desktop treasury
// dashboard; ?signer=alice|bob|carol → that signer's full-screen device view.
// All state lives in the useRimeState engine; this file is thin composition.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { SIGNER_SLUGS } from "@/lib/rime";
import { useRimeState } from "@/hooks/use-rime-state";
import { RimeStyles } from "@/components/rime-styles";
import { Dashboard } from "@/components/dashboard";
import { DeviceView } from "@/components/device-view";

function RimeApp() {
  const params = useSearchParams();
  const slug = (params.get("signer") || "").toLowerCase();
  const me = slug in SIGNER_SLUGS ? SIGNER_SLUGS[slug] : null;
  const rime = useRimeState(me);

  return (
    <>
      <RimeStyles />
      {me != null ? <DeviceView rime={rime} /> : <Dashboard rime={rime} />}
    </>
  );
}

function BootFallback() {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="rime-live-dot text-2xl text-primary" aria-hidden="true">
          ❄
        </span>
        <span className="font-serif text-2xl text-foreground">Rime</span>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<BootFallback />}>
      <RimeApp />
    </Suspense>
  );
}
