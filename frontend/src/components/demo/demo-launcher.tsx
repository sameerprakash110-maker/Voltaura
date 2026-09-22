"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button, ErrorState, LoadingPanel } from "@/components/ui/primitives";
import { StatusText } from "@/components/ui/structure";
import { useApi } from "@/lib/use-api";
import type { DemoScenario, DemoStage, DemoState } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Demo mode.
 *
 * A judge has a few minutes. This launcher removes every navigational step
 * between them and the interesting part: pick a scenario, land directly on the
 * anomaly that the detector actually found, and walk the loop from there.
 *
 * The stage label reads live from the backend, so it always shows how far that
 * scenario has genuinely progressed rather than a scripted position.
 */

const STAGE_LABEL: Record<DemoStage, string> = {
  DETECTED: "Detected",
  DIAGNOSED: "Diagnosed",
  RECOMMENDED: "Ready to action",
  INTERVENED: "Intervention applied",
  MONITORING: "Monitoring",
  VERIFIED: "Verified",
  NOT_DETECTED: "Not detected",
  UNAVAILABLE: "Unavailable",
};

export function DemoLauncher() {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm">
          <Play />
          <span className="hidden sm:inline">Demo</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] max-h-[86vh] w-[min(94vw,760px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-[rgb(var(--line)/0.16)] bg-elevated shadow-overlay data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <DemoContent onClose={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DemoContent({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data, error, loading, refetch } = useApi<DemoState>("/api/demo/scenarios");

  const go = (scenario: DemoScenario) => {
    if (!scenario.anomaly_id) return;
    onClose();
    router.push(`/anomalies/${scenario.anomaly_id}?demo=${scenario.key}`);
  };

  return (
    <>
      <div className="flex items-start justify-between gap-6 border-b border-[rgb(var(--line)/0.1)] px-6 py-5">
        <div>
          <div className="label mb-2">Demo mode</div>
          <Dialog.Title className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
            Walk the loop in three minutes
          </Dialog.Title>
          <Dialog.Description className="mt-2 max-w-lg text-[11.5px] leading-relaxed text-ink-muted">
            Each scenario is a real fault in the seeded telemetry. VOLTAURA found
            it independently — nothing below is pre-written. Pick one to jump
            straight to the diagnosis, then apply the intervention and verify the
            saving.
          </Dialog.Description>
        </div>
        <Dialog.Close asChild>
          <button
            className="shrink-0 text-ink-muted transition-colors hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </Dialog.Close>
      </div>

      <div className="px-6 py-2">
        {loading ? <LoadingPanel rows={3} className="py-4" /> : null}
        {error ? (
          <div className="py-4">
            <ErrorState error={error} onRetry={() => refetch()} compact />
          </div>
        ) : null}

        {data ? (
          <ul className="divide-y divide-[rgb(var(--line)/0.08)]">
            {data.scenarios.map((scenario) => (
              <li key={scenario.key}>
                <button
                  onClick={() => go(scenario)}
                  disabled={!scenario.available}
                  className={cn(
                    "group flex w-full items-start gap-5 py-4 text-left transition-colors",
                    scenario.available
                      ? "hover:bg-[rgb(var(--line)/0.025)]"
                      : "cursor-not-allowed opacity-45",
                  )}
                >
                  <span className="num w-6 shrink-0 pt-0.5 text-[11px] text-ink-faint">
                    0{scenario.order}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                        {scenario.title}
                      </span>
                      <span
                        className={cn(
                          "text-[10.5px] font-medium uppercase tracking-[0.09em]",
                          scenario.resource_type === "WATER"
                            ? "text-aqua"
                            : "text-mint",
                        )}
                      >
                        {scenario.resource_type}
                      </span>
                      <StatusText
                        status={STAGE_LABEL[scenario.stage] ?? scenario.stage}
                      />
                    </span>

                    <span className="mt-1.5 block text-[11.5px] leading-relaxed text-ink-soft">
                      {scenario.headline}
                    </span>

                    <span className="mt-2 block space-y-1">
                      {scenario.what_to_look_for.slice(0, 2).map((item) => (
                        <span
                          key={item}
                          className="flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-muted"
                        >
                          <span className="mt-[6px] size-[3px] shrink-0 rounded-full bg-ink-faint" />
                          {item}
                        </span>
                      ))}
                    </span>
                  </span>

                  <ArrowRight className="mt-1 size-3.5 shrink-0 text-ink-faint transition-colors group-hover:text-mint" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.1)] px-6 py-4">
        <p className="text-[11px] text-ink-muted">
          Two further measures are already verified on the Verification page.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onClose();
            router.push("/verification");
          }}
        >
          See verified savings <ArrowRight />
        </Button>
      </div>
    </>
  );
}
