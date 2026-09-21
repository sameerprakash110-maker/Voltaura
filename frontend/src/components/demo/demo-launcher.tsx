"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  BadgeCheck,
  Droplets,
  Lightbulb,
  Play,
  Wind,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Badge, Button, LoadingPanel, ErrorState } from "@/components/ui/primitives";
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
 * The stage badge reads live from the backend, so it always shows how far that
 * scenario has genuinely progressed rather than a scripted position.
 */

const SCENARIO_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "hvac-engineering": Wind,
  "leak-library": Droplets,
  "lighting-admin": Lightbulb,
};

const STAGE_TONE: Record<DemoStage, { tone: "neutral" | "medium" | "aqua" | "mint" | "critical"; label: string }> = {
  DETECTED: { tone: "medium", label: "Detected" },
  DIAGNOSED: { tone: "medium", label: "Diagnosed" },
  RECOMMENDED: { tone: "aqua", label: "Ready to action" },
  INTERVENED: { tone: "aqua", label: "Intervention applied" },
  MONITORING: { tone: "aqua", label: "Monitoring" },
  VERIFIED: { tone: "mint", label: "Verified" },
  NOT_DETECTED: { tone: "critical", label: "Not detected" },
  UNAVAILABLE: { tone: "critical", label: "Unavailable" },
};

export function DemoLauncher() {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Play className="size-3" />
          <span className="hidden sm:inline">Demo</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(94vw,760px)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel border border-[rgb(var(--line)/0.14)] bg-elevated shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
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
      <div className="flex items-start justify-between gap-4 border-b border-[rgb(var(--line)/0.1)] px-6 py-5">
        <div>
          <div className="eyebrow mb-1.5">Demo mode</div>
          <Dialog.Title className="font-display text-lg font-semibold text-ink">
            Walk the loop in three minutes
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 max-w-lg text-xs leading-relaxed text-ink-muted">
            Each scenario is a real fault in the seeded telemetry. EcoTwin found
            it independently -- nothing below is pre-written. Pick one to jump
            straight to the diagnosis, then apply the intervention and verify
            the saving.
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

      <div className="p-5">
        {loading ? <LoadingPanel rows={3} /> : null}
        {error ? <ErrorState error={error} onRetry={() => refetch()} compact /> : null}

        {data ? (
          <div className="space-y-2.5">
            {data.scenarios.map((scenario) => {
              const Icon = SCENARIO_ICONS[scenario.key] ?? Wind;
              const stage = STAGE_TONE[scenario.stage] ?? STAGE_TONE.DETECTED;
              return (
                <button
                  key={scenario.key}
                  onClick={() => go(scenario)}
                  disabled={!scenario.available}
                  className={cn(
                    "group flex w-full items-start gap-4 rounded-card border border-[rgb(var(--line)/0.1)] bg-surface/60 p-4 text-left transition-all duration-150",
                    scenario.available
                      ? "hover:border-mint/30 hover:bg-surface"
                      : "cursor-not-allowed opacity-50",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                      scenario.resource_type === "WATER"
                        ? "border-aqua/25 bg-aqua/10 text-aqua"
                        : "border-mint/25 bg-mint/10 text-mint",
                    )}
                  >
                    <Icon className="size-[18px]" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-2xs font-semibold tabular text-ink-muted">
                        0{scenario.order}
                      </span>
                      <h3 className="font-display text-sm font-semibold text-ink">
                        {scenario.title}
                      </h3>
                      <Badge tone={stage.tone} dot pulse={scenario.stage === "RECOMMENDED"}>
                        {stage.label}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                      {scenario.headline}
                    </p>
                    <ul className="mt-2.5 space-y-1">
                      {scenario.what_to_look_for.slice(0, 2).map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-muted"
                        >
                          <span className="mt-[5px] size-1 shrink-0 rounded-full bg-ink-muted/60" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <ArrowRight className="mt-1 size-4 shrink-0 text-ink-muted transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-mint" />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.1)] px-6 py-4">
        <p className="flex items-center gap-2 text-[11px] text-ink-muted">
          <BadgeCheck className="size-3.5 text-mint" />
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
          See verified savings <ArrowRight className="size-3" />
        </Button>
      </div>
    </>
  );
}
