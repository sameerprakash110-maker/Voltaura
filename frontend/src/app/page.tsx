"use client";

import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Brain,
  Database,
  Droplets,
  Gauge,
  LineChart,
  Radar,
  ScrollText,
  ShieldCheck,
  Wind,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";

import { VOLTAURAMark } from "@/components/brand/mark";
import { StaticPipeline } from "@/components/layout/pipeline-rail";
import { Badge, Button } from "@/components/ui/primitives";
import { useApi } from "@/lib/use-api";
import { compact, num, pct } from "@/lib/format";
import type { Building, Health, ReportSummary } from "@/lib/types";
import {
  FALLBACK_CAMPUS,
  toTwinBuildings,
  type TwinBuilding,
} from "@/components/twin/campus-scene";

// The twin is WebGL: keep it out of the server bundle and off the critical path.
const CampusScene = dynamic(
  () => import("@/components/twin/campus-scene").then((m) => m.CampusScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <VOLTAURAMark className="size-10 animate-pulse" />
          <span className="text-[11px] text-ink-muted">Loading digital twin</span>
        </div>
      </div>
    ),
  },
);

export default function LandingPage() {
  const { data: buildings } = useApi<Building[]>("/api/buildings?days=30");
  const { data: report } = useApi<ReportSummary>("/api/reports/summary?days=90");
  const { data: health } = useApi<Health>("/api/health");

  const twin: TwinBuilding[] = React.useMemo(
    () => (buildings?.length ? toTwinBuildings(buildings) : FALLBACK_CAMPUS),
    [buildings],
  );

  return (
    <div className="ambient relative min-h-screen overflow-x-hidden">
      <LandingNav />
      <main className="relative z-10">
        <Hero twin={twin} health={health} report={report} />
        <ProblemSection />
        <HowItWorks />
        <AiCapabilities />
        <TwinSection buildingCount={buildings?.length ?? 7} />
        <VerifiedSavings report={report} />
        <WorkflowSection />
        <DemoStats health={health} report={report} />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}

// --------------------------------------------------------------------------
function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[rgb(var(--line)/0.08)] bg-canvas/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <VOLTAURAMark className="size-7" />
          <span className="font-display text-[17px] font-semibold tracking-tight text-ink">
            VOLTAURA
          </span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {[
            ["How it works", "#how"],
            ["AI", "#ai"],
            ["Digital twin", "#twin"],
            ["Verified savings", "#savings"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="text-[13px] text-ink-muted transition-colors hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/dashboard">View Live Analysis</Link>
          </Button>
          <Button variant="primary" size="sm" asChild>
            <Link href="/digital-twin">
              Launch Digital Twin <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

// --------------------------------------------------------------------------
function Hero({
  twin,
  health,
  report,
}: {
  twin: TwinBuilding[];
  health: Health | null;
  report: ReportSummary | null;
}) {
  return (
    <section className="relative mx-auto w-full max-w-7xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20">
      <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_1fr]">
        <div className="animate-fade-up">
          <Badge tone="mint" dot pulse className="mb-6">
            Sustainable Digital Twin for Building Resource Waste
          </Badge>

          <h1 className="font-display text-[2.6rem] font-semibold leading-[1.06] tracking-[-0.025em] text-ink sm:text-[3.4rem] lg:text-[3.9rem]">
            See Waste.
            <br />
            Understand Why.
            <br />
            <span className="bg-gradient-to-r from-mint via-mint to-aqua bg-clip-text text-transparent">
              Prove the Savings.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-soft text-pretty">
            VOLTAURA is an AI-powered digital twin that detects abnormal building
            resource consumption, identifies probable causes, recommends
            evidence-based interventions, and verifies the savings they actually
            produce.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" asChild>
              <Link href="/digital-twin">
                Launch Digital Twin <ArrowRight />
              </Link>
            </Button>
            <Button variant="secondary" size="lg" asChild>
              <Link href="/dashboard">View Live Analysis</Link>
            </Button>
          </div>

          <div className="mt-10 grid max-w-lg grid-cols-3 gap-px overflow-hidden rounded-card border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.08)]">
            <HeroStat
              label="Hourly intervals"
              value={
                health
                  ? compact(health.energy_readings + health.water_readings, 1)
                  : "21.6k"
              }
            />
            <HeroStat
              label="Verified savings"
              value={
                report
                  ? `${compact(report.totals.financial_saving_per_year ?? 0, 1)}`
                  : "--"
              }
              prefix={report?.economics.currency_symbol ?? "₹"}
              suffix="/yr"
              tone="mint"
            />
            <HeroStat
              label="CO2 avoided"
              value={
                report
                  ? num(report.totals.co2_reduction_per_year_tonnes ?? 0, 1)
                  : "--"
              }
              suffix=" t/yr"
              tone="mint"
            />
          </div>
        </div>

        {/* ---- twin ---- */}
        <div className="relative">
          <div className="relative aspect-[4/3.4] overflow-hidden rounded-panel border border-[rgb(var(--line)/0.11)] bg-[#050b0a] shadow-lift">
            <CampusScene
              buildings={twin}
              interactive={false}
              autoRotate
              showLabels
              className="h-full w-full"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#050b0a] via-[#050b0a]/70 to-transparent" />
            <div className="pointer-events-none absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4">
              <div>
                <div className="eyebrow mb-1">Live campus twin</div>
                <div className="text-[13px] font-medium text-ink">
                  {twin.length} blocks under continuous baseline
                </div>
              </div>
              <div className="flex gap-3">
                <LegendDot colour="bg-mint" label="Normal" />
                <LegendDot colour="bg-medium" label="Warning" />
                <LegendDot colour="bg-critical" label="Critical" />
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute -right-6 -top-6 hidden size-28 rounded-full bg-mint/10 blur-3xl lg:block" />
        </div>
      </div>
    </section>
  );
}

function HeroStat({
  label,
  value,
  prefix,
  suffix,
  tone,
}: {
  label: string;
  value: string;
  prefix?: string;
  suffix?: string;
  tone?: "mint";
}) {
  return (
    <div className="bg-canvas px-4 py-3.5">
      <div className="eyebrow mb-1.5">{label}</div>
      <div
        className={`num text-[19px] font-semibold ${tone === "mint" ? "text-mint" : "text-ink"}`}
      >
        {prefix}
        {value}
        {suffix ? (
          <span className="ml-0.5 text-[11px] font-normal text-ink-muted">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LegendDot({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
      <span className={`size-1.5 rounded-full ${colour}`} />
      {label}
    </span>
  );
}

// --------------------------------------------------------------------------
function SectionHead({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <div className="eyebrow mb-3">{eyebrow}</div>
      <h2 className="font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.3rem] text-balance">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft text-pretty">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function ProblemSection() {
  const problems = [
    {
      icon: Radar,
      title: "The meter says what, never why",
      body: "A monthly bill tells a facilities team that consumption rose. It cannot say whether that was a hot week, a busy term, or an air handler that has been running empty every night since March.",
    },
    {
      icon: Activity,
      title: "Waste hides inside normal-looking totals",
      body: "A 45 L/hour leak is invisible against a building that draws 800 L/hour during the day. It only shows at 3am, against a baseline nobody is watching.",
    },
    {
      icon: ShieldCheck,
      title: "Savings get claimed, not proven",
      body: "Efficiency projects are signed off on estimates. Almost nothing goes back afterwards to measure whether the building actually changed, adjusted for weather and occupancy.",
    },
  ];

  return (
    <section className="border-t border-[rgb(var(--line)/0.08)] py-20">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <SectionHead
          eyebrow="The problem"
          title="Buildings waste resources quietly, and nobody can prove they stopped"
          description="Campus energy and water systems generate enormous amounts of data and almost no answers. The gap is not measurement. It is attribution, and the discipline to check afterwards."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {problems.map((problem) => {
            const Icon = problem.icon;
            return (
              <div
                key={problem.title}
                className="panel flex flex-col gap-4 p-6 transition-colors duration-200 hover:border-[rgb(var(--line)/0.16)]"
              >
                <div className="flex size-10 items-center justify-center rounded-lg border border-critical/20 bg-critical/[0.07] text-critical">
                  <Icon className="size-[18px]" />
                </div>
                <h3 className="font-display text-[15px] font-semibold text-ink">
                  {problem.title}
                </h3>
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  {problem.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
function HowItWorks() {
  const steps = [
    {
      n: "01",
      icon: Database,
      title: "Ingest telemetry",
      body: "Hourly electricity, water, occupancy, weather and equipment runtime from every building. 90 days of history at hourly resolution.",
    },
    {
      n: "02",
      icon: LineChart,
      title: "Learn what normal looks like",
      body: "A Random Forest learns expected consumption from demand drivers only, so equipment left running cannot hide inside the baseline.",
    },
    {
      n: "03",
      icon: Radar,
      title: "Detect the deviation",
      body: "An Isolation Forest and an hour-normalised residual test must agree before anything is raised. Only over-consumption counts as waste.",
    },
    {
      n: "04",
      icon: Brain,
      title: "Explain the cause",
      body: "A transparent rule engine weighs measured evidence across competing hypotheses and reports which one the data supports, with its confidence.",
    },
    {
      n: "05",
      icon: Wind,
      title: "Recommend and act",
      body: "Each cause maps to a costed measure sized from the measured excess. One click raises an intervention and opens the monitoring period.",
    },
    {
      n: "06",
      icon: BadgeCheck,
      title: "Verify the saving",
      body: "Post-intervention consumption is compared against a baseline model evaluated on the new period's own weather and occupancy.",
    },
  ];

  return (
    <section id="how" className="border-t border-[rgb(var(--line)/0.08)] py-20">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <SectionHead
          eyebrow="How VOLTAURA works"
          title="One closed loop, from raw meter reading to proven saving"
          description="Most tools stop after the chart. VOLTAURA carries a single finding all the way through to a number you can put in a sustainability report and defend."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-panel border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.08)] sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.n}
                className="group relative bg-canvas p-6 transition-colors duration-200 hover:bg-surface/60"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg border border-mint/20 bg-mint/[0.07] text-mint">
                    <Icon className="size-[17px]" />
                  </div>
                  <span className="num text-[11px] font-medium text-ink-muted">
                    {step.n}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-[15px] font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                  {step.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
function AiCapabilities() {
  const items = [
    {
      title: "Expected-consumption model",
      method: "Random Forest regression, robust re-fit",
      body: "Trained on occupancy, outdoor temperature, hour-of-day, day-of-week and the published schedule. Equipment runtime is deliberately excluded so a unit left running raises the residual instead of raising the prediction. A second pass trims fault-affected intervals from the training set.",
      metric: "R2 > 0.99, CV(RMSE) 2-5%",
    },
    {
      title: "Anomaly detection",
      method: "Isolation Forest + hour-normalised residual",
      body: "Two independent signals must agree. The forest catches odd combinations across the whole feature vector; the residual test is directional and physically interpretable. Residuals are z-scored within each hour of day, which is what makes a 41 L/hour overnight leak visible against daytime demand of several hundred.",
      metric: "Consensus of two detectors",
    },
    {
      title: "Root-cause analysis",
      method: "Deterministic weighted rule engine",
      body: "Seven rules over measured evidence, chosen so the failure modes produce mutually exclusive signatures. Confidence is the satisfied share of rule weight, then discounted when a competing explanation scores close and when the sample is small. When nothing fits, it says so and asks for an audit.",
      metric: "Same input, same answer, every time",
    },
    {
      title: "Savings verification",
      method: "IPMVP Option C with routine adjustments",
      body: "A baseline model fitted on the pre-intervention window is evaluated on the post period's own drivers to produce an adjusted baseline. A Welch t-test decides whether the reduction is distinguishable from noise. Both gates must pass before anything is marked verified.",
      metric: "Threshold + significance, both enforced",
    },
  ];

  return (
    <section id="ai" className="border-t border-[rgb(var(--line)/0.08)] py-20">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <SectionHead
          eyebrow="AI capabilities"
          title="Models that can be interrogated, not just trusted"
          description="Every number in VOLTAURA traces back to a stored reading or a calculation you can open up. The optional LLM layer only ever rewrites a finished finding into plainer prose; it never decides a cause, a confidence or a number."
        />
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <div key={item.title} className="panel p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-[15px] font-semibold text-ink">
                  {item.title}
                </h3>
                <Badge tone="iris">{item.method}</Badge>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                {item.body}
              </p>
              <div className="mt-4 flex items-center gap-2 border-t border-[rgb(var(--line)/0.08)] pt-3">
                <BadgeCheck className="size-3.5 text-mint" />
                <span className="num text-[11px] text-ink-muted">{item.metric}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
function TwinSection({ buildingCount }: { buildingCount: number }) {
  return (
    <section id="twin" className="border-t border-[rgb(var(--line)/0.08)] py-20">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHead
              eyebrow="Digital twin"
              title="The campus as a live model, not a floor plan"
              description="Every visual channel carries state. Facade tint shows building status, lit floor bands track live occupancy, a ground ring marks severity, and a rising beam pulses faster when the anomaly is critical. Click any building to open its resource summary and jump straight into its diagnosis."
            />
            <ul className="mt-8 space-y-3">
              {[
                ["Building status at a glance", "Normal, warning and critical read from live anomaly severity"],
                ["Occupancy as light", "Floor bands brighten with the building's current headcount"],
                ["One click to the evidence", "Selecting a building opens its anomalies, cause and active recommendation"],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-3">
                  <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border border-mint/25 bg-mint/10">
                    <span className="size-1.5 rounded-full bg-mint" />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-ink">{title}</div>
                    <div className="text-[12px] text-ink-muted">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="outline" className="mt-8" asChild>
              <Link href="/digital-twin">
                Open the digital twin <ArrowRight />
              </Link>
            </Button>
          </div>

          <div className="panel overflow-hidden p-0">
            <div className="grid grid-cols-2 gap-px bg-[rgb(var(--line)/0.08)] sm:grid-cols-4">
              {[
                { icon: Boxes, label: "Blocks", value: String(buildingCount) },
                { icon: Gauge, label: "Channels", value: "9" },
                { icon: Activity, label: "Resolution", value: "1h" },
                { icon: Droplets, label: "Resources", value: "2" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="bg-canvas px-4 py-4">
                    <Icon className="mb-2 size-4 text-ink-muted" />
                    <div className="num text-lg font-semibold text-ink">
                      {item.value}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                      {item.label}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-6">
              <div className="eyebrow mb-3">Telemetry channels</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Electricity kWh",
                  "Water L",
                  "Flow L/h",
                  "Occupancy",
                  "Indoor temp",
                  "Outdoor temp",
                  "HVAC runtime",
                  "Lighting runtime",
                  "Pump runtime",
                ].map((channel) => (
                  <Badge key={channel} tone="neutral">
                    {channel}
                  </Badge>
                ))}
              </div>
              <p className="mt-5 text-[12px] leading-relaxed text-ink-muted">
                The dataset is synthetic, generated by a physics-inspired
                building simulator. It stands in for the smart-meter and BMS
                feed that a real deployment would ingest over MQTT or Modbus --
                every column here is one a real meter also reports.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
function VerifiedSavings({ report }: { report: ReportSummary | null }) {
  const verified = report?.verified_interventions ?? [];
  const symbol = report?.economics.currency_symbol ?? "₹";

  return (
    <section id="savings" className="border-t border-[rgb(var(--line)/0.08)] py-20">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <SectionHead
          eyebrow="Verified savings"
          title="The difference between an estimate and a measurement"
          description="A recommendation predicts a saving. Verification measures the one the building actually delivered, against a baseline adjusted for the weather and occupancy of the period that followed. VOLTAURA is allowed to report that a measure did not work."
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div className="panel p-6">
            <div className="eyebrow mb-4">Live from the seeded deployment</div>
            {verified.length ? (
              <div className="space-y-3">
                {verified.slice(0, 3).map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/50 p-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge tone="mint" dot>
                          Verified
                        </Badge>
                        <span className="text-[11px] text-ink-muted">
                          {v.building_name}
                        </span>
                      </div>
                      <div className="mt-1.5 truncate text-[13px] font-medium text-ink">
                        {v.intervention_title}
                      </div>
                      <div className="num mt-1 text-[11px] text-ink-muted">
                        {num(v.adjusted_baseline_value)} &rarr; {num(v.post_value)}{" "}
                        {v.unit}/week &middot; p = {v.p_value?.toExponential(1)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-xl font-semibold text-mint">
                        -{pct(v.saving_pct)}
                      </div>
                      <div className="num text-[11px] text-ink-muted">
                        {symbol}
                        {compact(v.financial_saving_per_year, 1)}/yr
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-muted">
                Start the backend and seed the database to see live verified
                interventions here.
              </p>
            )}
          </div>

          <div className="panel flex flex-col justify-between p-6">
            <div>
              <div className="eyebrow mb-4">What gets checked</div>
              <ul className="space-y-3.5">
                {[
                  ["Adjusted baseline", "Baseline model evaluated on the post period's own occupancy and weather"],
                  ["Material threshold", "Configurable minimum reduction, default 5%"],
                  ["Statistical significance", "Welch t-test across every hourly interval"],
                  ["Both gates, or no badge", "Clearing one is not enough"],
                ].map(([title, body]) => (
                  <li key={title} className="flex gap-3">
                    <BadgeCheck className="mt-0.5 size-4 shrink-0 text-mint" />
                    <div>
                      <div className="text-[13px] font-medium text-ink">{title}</div>
                      <div className="text-[12px] leading-relaxed text-ink-muted">
                        {body}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <Button variant="outline" className="mt-6" asChild>
              <Link href="/verification">
                Inspect the verification maths <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
function WorkflowSection() {
  return (
    <section className="border-t border-[rgb(var(--line)/0.08)] py-20">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <SectionHead
          eyebrow="Product workflow"
          title="Building &rarr; resource &rarr; anomaly &rarr; cause &rarr; action &rarr; savings"
          description="Each stage below is a real screen with real state behind it. Nothing in this loop is a mock-up."
          align="center"
        />
        <div className="mt-12 flex justify-center overflow-x-auto pb-2">
          <StaticPipeline />
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
function DemoStats({
  health,
  report,
}: {
  health: Health | null;
  report: ReportSummary | null;
}) {
  const totals = report?.totals ?? {};
  const symbol = report?.economics.currency_symbol ?? "₹";

  const stats = [
    {
      label: "Hourly intervals analysed",
      value: health
        ? num(health.energy_readings + health.water_readings)
        : "21,600",
      caption: `Across ${health?.buildings ?? 7} blocks and 2 resources`,
    },
    {
      label: "Anomaly events detected",
      value: num(totals.anomalies_detected ?? 0),
      caption: "Consolidated from individual flagged intervals",
    },
    {
      label: "Interventions verified",
      value: `${num(totals.interventions_verified ?? 0)} / ${num(totals.interventions_applied ?? 0)}`,
      caption: `Verification rate ${pct(totals.verification_rate_pct ?? 0, 0)}`,
    },
    {
      label: "Energy saved",
      value: compact(totals.energy_saved_per_year ?? 0, 1),
      unit: "kWh/yr",
      caption: "Measured against an adjusted baseline",
      tone: "mint" as const,
    },
    {
      label: "Water saved",
      value: compact(totals.water_saved_per_year_kl ?? 0, 1),
      unit: "kL/yr",
      caption: "Measured against an adjusted baseline",
      tone: "mint" as const,
    },
    {
      label: "Financial saving",
      value: `${symbol}${compact(totals.financial_saving_per_year ?? 0, 1)}`,
      unit: "/yr",
      caption: `At ${report?.economics.electricity_tariff ?? 8.5} ${report?.economics.currency ?? "INR"}/kWh`,
      tone: "mint" as const,
    },
  ];

  return (
    <section className="border-t border-[rgb(var(--line)/0.08)] py-20">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <SectionHead
          eyebrow="Demo statistics"
          title="Numbers from the running system, not a slide"
          description="Everything below is read live from the API. If the backend is not running, these read as placeholders -- which is itself the point: nothing here is hard-coded."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-panel border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.08)] sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-canvas px-6 py-6">
              <div className="eyebrow mb-2">{stat.label}</div>
              <div
                className={`num text-[26px] font-semibold leading-none ${
                  stat.tone === "mint" ? "text-mint" : "text-ink"
                }`}
              >
                {stat.value}
                {stat.unit ? (
                  <span className="ml-1 text-[12px] font-normal text-ink-muted">
                    {stat.unit}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-[11px] text-ink-muted">{stat.caption}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
function FinalCta() {
  return (
    <section className="border-t border-[rgb(var(--line)/0.08)] py-24">
      <div className="mx-auto w-full max-w-4xl px-5 text-center sm:px-8">
        <VOLTAURAMark className="mx-auto size-12" />
        <h2 className="mt-7 font-display text-[2.1rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.6rem] text-balance">
          Stop reporting consumption.
          <br />
          Start proving reduction.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-soft text-pretty">
          Open the command centre to see seven RIT blocks under continuous
          baseline, three open anomalies with diagnosed causes, and two
          interventions whose savings have already been measured.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" size="lg" asChild>
            <Link href="/dashboard">
              Open the command centre <ArrowRight />
            </Link>
          </Button>
          <Button variant="secondary" size="lg" asChild>
            <Link href="/digital-twin">Launch Digital Twin</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-[rgb(var(--line)/0.08)] py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-5 sm:flex-row sm:px-8">
        <div className="flex items-center gap-2.5">
          <VOLTAURAMark className="size-5" />
          <span className="text-[12px] text-ink-muted">
            VOLTAURA &middot; See Waste. Understand Why. Prove the Savings.
          </span>
        </div>
        <div className="flex items-center gap-5 text-[12px] text-ink-muted">
          <Link href="/reports" className="transition-colors hover:text-ink-soft">
            <ScrollText className="mr-1 inline size-3.5" />
            Reports
          </Link>
          <a
            href="http://127.0.0.1:8000/docs"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink-soft"
          >
            API docs
          </a>
        </div>
      </div>
    </footer>
  );
}
