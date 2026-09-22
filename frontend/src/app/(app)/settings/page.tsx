"use client";

import { Check, Moon, RotateCcw, Save, Sun } from "lucide-react";
import * as React from "react";

import { useAppState } from "@/components/providers/app-state";
import {
  Button,
  ErrorState,
  LoadingPanel,
  Segmented,
} from "@/components/ui/primitives";
import { PageHeader, Section, StatusText } from "@/components/ui/structure";
import { api } from "@/lib/api";
import type { SettingsPayload } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Configuration.
 *
 * Every value on this page feeds a real calculation, so each one is presented
 * as an input with its own units, bounds and default rather than as a styled
 * control. The "modified" marker exists because being able to see at a glance
 * which assumptions have been moved is the difference between a configurable
 * model and an unaccountable one.
 */
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
    <div className="space-y-8">
      <PageHeader
        label="System"
        title="Configuration"
        description="Change a tariff and every financial figure moves; raise the verification threshold and a previously verified saving will fail on the next run."
        actions={
          <>
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
          </>
        }
      />

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {save.error ? <ErrorState error={save.error} compact /> : null}
      {loading && !data ? <LoadingPanel rows={6} /> : null}

      {/* ---- interface ---- */}
      <Section
        label="Interface"
        title="Display preferences"
        description="Stored in this browser only. Nothing here reaches the backend."
      >
        <div className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
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
      </Section>

      {/* ---- calculation settings ---- */}
      {data
        ? Object.entries(groups).map(([group, items]) => (
            <Section
              key={group}
              label={group}
              title={GROUP_TITLES[group] ?? group}
              description={GROUP_SUBTITLES[group]}
            >
              <div className="grid gap-x-10 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((meta) => {
                  const value = draft[meta.key] ?? data.values[meta.key];
                  const isDefault =
                    Number(value) === Number(data.defaults[meta.key]);
                  return (
                    <div key={meta.key}>
                      <div className="flex items-baseline justify-between gap-3">
                        <label
                          htmlFor={meta.key}
                          className="text-[12.5px] font-medium text-ink"
                        >
                          {meta.label}
                        </label>
                        {!isDefault ? <StatusText status="Modified" /> : null}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                        {meta.help}
                      </p>
                      <div className="mt-3 flex items-center gap-2.5">
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
                            "num w-28 rounded border bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink transition-colors",
                            isDefault
                              ? "border-[rgb(var(--line)/0.14)]"
                              : "border-medium/45",
                            "focus:border-mint/60 focus:outline-none",
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
                            className="num ml-auto text-[10.5px] text-ink-faint underline underline-offset-2 transition-colors hover:text-ink-soft"
                          >
                            default {data.defaults[meta.key]}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          ))
        : null}

      {/* ---- LLM ---- */}
      <Section
        label="Optional LLM"
        title="Natural-language narratives"
        actions={<StatusText status={data?.llm_enabled ? "Active" : "Pending"} />}
      >
        <div className="max-w-3xl">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            VOLTAURA runs completely without an LLM. Every cause, number and
            verdict is computed locally from the meter data. When an API key is
            present, the LLM does exactly one thing: rewrite a finished
            diagnosis into a more fluent paragraph. It never decides a cause, a
            confidence or a number.
          </p>
          <p className="mt-4 font-mono text-[11px] text-ink-muted">
            {data?.llm_enabled
              ? `Model: ${data.llm_model}`
              : "Set VOLTAURA_LLM_API_KEY in your environment to enable."}
          </p>
        </div>
      </Section>

      {data ? (
        <p className="max-w-3xl border-t border-[rgb(var(--line)/0.08)] pt-5 text-[11px] leading-relaxed text-ink-muted">
          Detection thresholds take effect on the next detection run. Go to the
          Anomaly Monitor and press &ldquo;Re-run detection&rdquo; to rebuild the
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
    "A saving must clear both of these before it is marked verified. Raising the minimum reduction is the fastest way to prove the product is measuring rather than asserting.",
  Detection:
    "Governs how sensitive detection is. Tightening these reduces false alarms at the cost of missing smaller deviations.",
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
      <p className="mb-3 mt-1.5 text-[11px] leading-relaxed text-ink-muted">{help}</p>
      {children}
    </div>
  );
}
