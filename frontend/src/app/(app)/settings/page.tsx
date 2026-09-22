"use client";

import { Check, RotateCcw, Save, Sparkles, Sun, Moon } from "lucide-react";
import * as React from "react";

import { useAppState } from "@/components/providers/app-state";
import {
  Badge,
  Button,
  ErrorState,
  LoadingPanel,
  Panel,
  PanelHeader,
  Segmented,
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { SettingsPayload } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const { theme, toggleTheme, range, setRange, resource, setResource } =
    useAppState();
  const { data, error, loading, refetch } = useApi<SettingsPayload>("/api/settings");

  const [draft, setDraft] = React.useState<Record<string, number>>({});
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (data) setDraft(data.values);
  }, [data]);

  const save = useMutation(async (values: Record<string, number>) => {
    await api.put("/api/settings", { values });
    await refetch({ quiet: true });
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
  });

  const reset = useMutation(async () => {
    const payload = await api.post<SettingsPayload>("/api/settings/reset", {});
    setDraft(payload.values);
    await refetch({ quiet: true });
  });

  const dirty = React.useMemo(() => {
    if (!data) return false;
    return Object.keys(draft).some(
      (key) => Number(draft[key]) !== Number(data.values[key]),
    );
  }, [draft, data]);

  const groups = React.useMemo(() => {
    const out: Record<string, SettingsPayload["metadata"]> = {};
    (data?.metadata ?? []).forEach((meta) => {
      (out[meta.group] ??= []).push(meta);
    });
    return out;
  }, [data]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Settings</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Configuration
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] text-ink-muted">
            Every value here feeds a real calculation. Change a tariff and the
            financial figures move; raise the verification threshold and a
            previously verified saving will fail on the next run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            loading={reset.pending}
            onClick={() => reset.mutate()}
          >
            <RotateCcw /> Reset to defaults
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty}
            loading={save.pending}
            onClick={() => save.mutate(draft)}
          >
            {saved ? <Check /> : <Save />}
            {saved ? "Saved" : "Save changes"}
          </Button>
        </div>
      </header>

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {save.error ? <ErrorState error={save.error} compact /> : null}
      {loading && !data ? (
        <Panel>
          <LoadingPanel rows={5} />
        </Panel>
      ) : null}

      {/* ---- interface preferences ---- */}
      <Panel>
        <PanelHeader
          eyebrow="Interface"
          title="Display preferences"
          subtitle="Stored in this browser only."
        />
        <div className="grid gap-5 px-5 pb-5 sm:grid-cols-3">
          <Field label="Colour theme" help="Dark is the default for wall displays.">
            <Button variant="secondary" size="sm" onClick={toggleTheme}>
              {theme === "dark" ? <Moon /> : <Sun />}
              {theme === "dark" ? "Dark" : "Light"}
            </Button>
          </Field>
          <Field label="Default date range" help="Applied across every screen.">
            <Segmented
              size="sm"
              options={[
                { value: 7, label: "7 days" },
                { value: 30, label: "30 days" },
                { value: 90, label: "90 days" },
              ]}
              value={range}
              onChange={setRange}
            />
          </Field>
          <Field label="Default resource" help="Filters dashboards and lists.">
            <Segmented
              size="sm"
              options={[
                { value: "ALL", label: "All" },
                { value: "ENERGY", label: "Energy" },
                { value: "WATER", label: "Water" },
              ]}
              value={resource}
              onChange={setResource}
            />
          </Field>
        </div>
      </Panel>

      {/* ---- calculation settings ---- */}
      {data
        ? Object.entries(groups).map(([group, items]) => (
            <Panel key={group}>
              <PanelHeader
                eyebrow={group}
                title={GROUP_TITLES[group] ?? group}
                subtitle={GROUP_SUBTITLES[group]}
              />
              <div className="grid gap-px overflow-hidden border-t border-[rgb(var(--line)/0.08)] bg-[rgb(var(--line)/0.07)] sm:grid-cols-2">
                {items.map((meta) => {
                  const value = draft[meta.key] ?? data.values[meta.key];
                  const isDefault =
                    Number(value) === Number(data.defaults[meta.key]);
                  return (
                    <div key={meta.key} className="bg-surface p-5">
                      <div className="flex items-start justify-between gap-3">
                        <label
                          htmlFor={meta.key}
                          className="text-[12.5px] font-medium text-ink"
                        >
                          {meta.label}
                        </label>
                        {!isDefault ? (
                          <Badge tone="medium">Modified</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                        {meta.help}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          id={meta.key}
                          type="number"
                          step={meta.step}
                          min={meta.min}
                          max={meta.max}
                          value={value ?? ""}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              [meta.key]: Number(event.target.value),
                            }))
                          }
                          className={cn(
                            "num w-32 rounded-lg border bg-canvas px-3 py-1.5 text-[13px] text-ink transition-colors",
                            "border-[rgb(var(--line)/0.14)] focus:border-mint/50 focus:outline-none",
                          )}
                        />
                        <span className="text-[11px] text-ink-muted">
                          {meta.unit}
                        </span>
                        {!isDefault ? (
                          <button
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                [meta.key]: data.defaults[meta.key],
                              }))
                            }
                            className="ml-auto text-[10px] text-ink-muted underline underline-offset-2 transition-colors hover:text-ink-soft"
                          >
                            default {data.defaults[meta.key]}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))
        : null}

      {/* ---- LLM ---- */}
      <Panel>
        <PanelHeader
          eyebrow="Optional LLM"
          title="Natural-language narratives"
          action={
            <Badge tone={data?.llm_enabled ? "iris" : "neutral"} dot>
              {data?.llm_enabled ? "Active" : "Not configured"}
            </Badge>
          }
        />
        <div className="px-5 pb-5">
          <div className="flex items-start gap-3 rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/50 p-4">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-iris" />
            <div>
              <p className="text-[12.5px] leading-relaxed text-ink-soft">
                VOLTAURA runs completely without an LLM. Detection, diagnosis,
                recommendations and verification are all deterministic and
                computed locally. When an API key is present, the LLM is used
                for exactly one thing: rewriting an already-computed diagnosis
                into a fluent paragraph. It never decides a cause, a confidence
                or a number, and every failure falls back silently to the
                deterministic narrative.
              </p>
              <p className="mt-3 font-mono text-[11px] text-ink-muted">
                {data?.llm_enabled
                  ? `Model: ${data.llm_model}`
                  : "Set VOLTAURA_LLM_API_KEY in your environment to enable."}
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {data ? (
        <p className="pb-4 text-[11px] leading-relaxed text-ink-muted">
          Detection thresholds take effect on the next detection run. Go to
          Anomalies and press &ldquo;Re-run detection&rdquo; to rebuild the
          anomaly list from the same telemetry under the new configuration.
          Verification settings apply the next time a verification is run.
        </p>
      ) : null}
    </div>
  );
}

const GROUP_TITLES: Record<string, string> = {
  Economics: "Tariffs",
  Carbon: "Emission factors",
  Verification: "Measurement and verification",
  Detection: "Anomaly detection",
};

const GROUP_SUBTITLES: Record<string, string> = {
  Economics: "Used to convert physical savings into money.",
  Carbon: "Used to convert physical savings into avoided emissions.",
  Verification:
    "Both gates must pass before a saving is marked verified. Raising the threshold is the fastest way to prove the engine is measuring rather than asserting.",
  Detection:
    "Governs how sensitive the detectors are. Tightening them reduces false positives at the cost of missing smaller deviations.",
};

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[12.5px] font-medium text-ink">{label}</div>
      <p className="mb-2.5 mt-1 text-[11px] text-ink-muted">{help}</p>
      {children}
    </div>
  );
}
