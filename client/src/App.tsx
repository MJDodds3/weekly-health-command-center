import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Database,
  Droplets,
  HeartPulse,
  Moon,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Sun,
  Trophy,
  Utensils,
  Gauge,
  BarChart3,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiRequest, queryClient } from "./lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

type MetricDirection = "positive" | "neutral" | "warning";

type CoreMetric = {
  group: string;
  name: string;
  value: number;
  unit: string;
  delta: number;
  status: string;
  direction: MetricDirection;
  scoreImpact: number;
  priorValue: number;
  band?: "green" | "yellow" | "red" | "missing" | "neutral";
  source?: string;
  currentN?: number;
  priorN?: number;
  dailyValues?: Array<{
    date: string;
    value: number | null;
    band?: "green" | "yellow" | "red" | "missing" | "neutral";
    status?: string;
  }>;
};

type SupportMetric = {
  name: string;
  value: number;
  unit: string;
  delta: number | null;
  status: string;
  band?: "green" | "yellow" | "red";
  priorValue: number | null;
  source?: string;
  currentN?: number;
  priorN?: number;
};

type NutritionMetric = {
  name: string;
  value: number;
  unit: string;
  delta: number;
  priorValue: number;
  status?: string;
  band?: "green" | "yellow" | "red" | "missing" | "neutral";
  source?: string;
  currentN?: number;
  priorN?: number;
  dailyValues?: CoreMetric["dailyValues"];
};

type WeeklyReport = {
  mode: string;
  updatedAt: string;
  cadence: string;
  person: string;
  organization: string;
  currentWindow: string;
  priorWindow: string;
  displayedRange: string;
  latestDataDate?: string | null;
  latestDataLagDays?: number | null;
  score: number;
  scoreBand: string;
  scoreDelta: number;
  sources: string[];
  processingNote: string;
  wins: Array<{ metric: string; text: string; delta: number }>;
  focusAreas: Array<{ metric: string; text: string }>;
  coreMetrics: CoreMetric[];
  supportMetrics: SupportMetric[];
  nutritionMetrics?: NutritionMetric[];
  insulinResistance?: {
    score: number;
    range: string;
    resultDate: string;
    source?: "data-dictionary" | "databricks";
    overlayedMetrics?: string[];
    components: Array<{ metric: string; value: number; score: number }>;
  };
  scoreTrend: Array<{ date: string; score: number; glucose: number; glucoseIndex: number; sleepScore: number; hrv: number; hrvIndex: number }>;
  databricks: {
    ready: boolean;
    requiredEnv: string[];
    queryMode: string;
    schedule: string;
    warehouseId?: string;
    sourceTable?: string;
    suggestedTables: string[];
  };
};

const fallbackCoreMetrics: CoreMetric[] = [
  { group: "Body Composition", name: "Weight", value: 154.75005189, unit: "lb", delta: 1.03824189, status: "On Target", direction: "neutral", scoreImpact: 5, priorValue: 153.71181, source: "withings2", currentN: 7, priorN: 7 },
  { group: "Body Composition", name: "Body Fat", value: 8.09642857, unit: "%", delta: 0.06342857, status: "On Target", direction: "neutral", scoreImpact: 5, priorValue: 8.033, source: "withings2", currentN: 7, priorN: 7 },
  { group: "Body Composition", name: "Visceral Fat", value: 2.29999967, unit: "%", delta: 0, status: "Above Target", direction: "warning", scoreImpact: 3, priorValue: 2.3, source: "withings2", currentN: 6, priorN: 7 },
  { group: "Body Composition", name: "Cellular Water Ratio", value: 148.45566207, unit: "%", delta: -2.27856701, status: "On Target", direction: "neutral", scoreImpact: 5, priorValue: 150.73422908, source: "withings2", currentN: 6, priorN: 7 },
  { group: "Metabolic Health", name: "Glucose", value: 81.53002535, unit: "mg/dL", delta: -6.87076831, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 88.40079365, source: "healthkit2", currentN: 7, priorN: 7 },
  { group: "Metabolic Health", name: "Ketones", value: 0.31428571, unit: "mmol/L", delta: -0.11428571, status: "Below Target", direction: "warning", scoreImpact: 2, priorValue: 0.42857143, source: "mymojohealth", currentN: 7, priorN: 7 },
  { group: "Metabolic Health", name: "Insulin Load", value: 153.71, unit: "g", delta: 19.46285714, status: "Above Target", direction: "warning", scoreImpact: 3, priorValue: 134.24714286, source: "cronometer", currentN: 6, priorN: 7 },
  { group: "Sleep", name: "Total Sleep", value: 7.1, unit: "hrs", delta: 0.51428571, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 6.58571429, source: "oura", currentN: 7, priorN: 7 },
  { group: "Sleep", name: "Sleep Efficiency", value: 84.85714286, unit: "%", delta: 0.14285714, status: "On Target", direction: "neutral", scoreImpact: 5, priorValue: 84.71428571, source: "oura", currentN: 7, priorN: 7 },
  { group: "Sleep", name: "Sleep Score", value: 82, unit: "", delta: 2.57142857, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 79.42857143, source: "oura", currentN: 7, priorN: 7 },
  { group: "Cardiovascular & Stress", name: "Heart Rate Variability", value: 22.85714286, unit: "ms", delta: 0.42857143, status: "Below Target", direction: "warning", scoreImpact: 2, priorValue: 22.42857143, source: "oura", currentN: 7, priorN: 7 },
  { group: "Cardiovascular & Stress", name: "Resting HR", value: 73.85714286, unit: "bpm", delta: -0.42857143, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 74.28571429, source: "oura", currentN: 7, priorN: 7 },
  { group: "Cardiovascular & Stress", name: "Stress Level", value: 2.16666667, unit: "", delta: -0.11904762, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 2.28571429, source: "oura", currentN: 6, priorN: 7 },
  { group: "Cardiovascular & Stress", name: "Resilience", value: 3.71428571, unit: "", delta: 0, status: "On Target", direction: "neutral", scoreImpact: 5, priorValue: 3.71428571, source: "oura", currentN: 7, priorN: 7 },
  { group: "Activity", name: "Steps", value: 10657, unit: "steps", delta: -598, status: "Above Target", direction: "warning", scoreImpact: 3, priorValue: 11255, source: "oura", currentN: 7, priorN: 7 },
  { group: "Activity", name: "Vo2max", value: 44, unit: "ml/kg/min", delta: 0.5, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 43.5, source: "oura", currentN: 6, priorN: 6 },
];

const fallbackReport: WeeklyReport = {
  mode: "standalone databricks-export",
  updatedAt: new Date().toISOString(),
  cadence: "Fridays at 3:00 PM PT",
  person: "Matthew Dodds",
  organization: "Eternity Medicine Institute",
  currentWindow: "Apr 28-May 4",
  priorWindow: "Apr 21-Apr 27",
  displayedRange: "April 28 — May 04, 2026",
  score: 85,
  scoreBand: "Good",
  scoreDelta: 0,
  sources: ["Oura", "Apple HealthKit", "Cronometer", "Withings", "MyMojoHealth", "Databricks"],
  processingNote: "Deduped by dashboard source preference; weekly averages exported from workspace.default.dailytracker_joined",
  wins: [
    { metric: "Glucose", text: "Improved by 6.9 mg/dL vs prior week", delta: -6.87076831 },
    { metric: "Sleep Score", text: "Improved by 2.6 vs prior week", delta: 2.57142857 },
    { metric: "Total Sleep", text: "Improved by 0.5 hrs vs prior week", delta: 0.51428571 },
  ],
  focusAreas: [
    { metric: "Calories Consumed", text: "3,231 cal — Above Target (+535.6 vs prior week)" },
    { metric: "Insulin Load", text: "153.7 g — Above Target (+19.5 vs prior week)" },
    { metric: "Ketones", text: "0.31 mmol/L — Below Target" },
    { metric: "Heart Rate Variability", text: "22.9 ms — Below Target" },
  ],
  coreMetrics: fallbackCoreMetrics,
  supportMetrics: [
    { name: "Calories Burned", value: 2883.28571429, unit: "cal", delta: -62.28571429, status: "On Target", priorValue: 2945.57142857, source: "oura", currentN: 7, priorN: 7 },
    { name: "Calories Consumed", value: 3231, unit: "cal", delta: 535.55714286, status: "Above Target", priorValue: 2695.44285714, source: "cronometer", currentN: 6, priorN: 7 },
    { name: "Avg Daily Balance", value: -347.71428571, unit: "cal/day", delta: -597.84285715, status: "Deficit", priorValue: 250.12857143, source: "derived", currentN: 6, priorN: 7 },
  ],
  nutritionMetrics: [],
  insulinResistance: {
    score: 4,
    range: "Low",
    resultDate: "2026-03-31",
    components: [
      { metric: "Insulin (Fasting)", value: 2.3, score: 0 },
      { metric: "Hemoglobin A1c (HbA1c)", value: 5.3, score: 1 },
      { metric: "Glucose (Fasting)", value: 87, score: 1 },
      { metric: "Uric Acid", value: 4.2, score: 0 },
      { metric: "HOMA-IR", value: 0.49, score: 0 },
      { metric: "Triglycerides (TG)", value: 37, score: 0 },
      { metric: "HDL Cholesterol", value: 63, score: 0 },
      { metric: "Trig:HDL ratio", value: 0.59, score: 0 },
      { metric: "Thyroid Stimulating Hormone (TSH)", value: 1.03, score: 0 },
      { metric: "LDL:HDL Ratio", value: 1.25, score: 0 },
      { metric: "Cholesterol:HDL Ratio", value: 2.4, score: 0 },
    ],
  },
  scoreTrend: [
    { date: "04-28", score: 82, glucose: 83, glucoseIndex: 91, sleepScore: 80, hrv: 24, hrvIndex: 68 },
    { date: "04-29", score: 84, glucose: 82, glucoseIndex: 92, sleepScore: 82, hrv: 23, hrvIndex: 66 },
    { date: "04-30", score: 86, glucose: 82, glucoseIndex: 92, sleepScore: 83, hrv: 23, hrvIndex: 66 },
    { date: "05-01", score: 85, glucose: 81, glucoseIndex: 93, sleepScore: 82, hrv: 22, hrvIndex: 64 },
    { date: "05-02", score: 85, glucose: 81, glucoseIndex: 93, sleepScore: 82, hrv: 23, hrvIndex: 66 },
    { date: "05-03", score: 85, glucose: 81, glucoseIndex: 93, sleepScore: 82, hrv: 23, hrvIndex: 66 },
    { date: "05-04", score: 85, glucose: 82, glucoseIndex: 92, sleepScore: 82, hrv: 23, hrvIndex: 66 },
  ],
  databricks: {
    ready: true,
    requiredEnv: ["DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"],
    queryMode: "past_7_days_vs_prior_7_days",
    schedule: "0 22 * * FRI",
    warehouseId: "33ede2bc605f8cd7",
    sourceTable: "workspace.default.dailytracker_joined",
    suggestedTables: ["workspace.default.dailytracker_joined", "workspace.default.dailyperformance_joined", "workspace.default.labs_joined", "workspace.default.bodycomp", "workspace.default.metabolism"],
  },
};

const navItems = [
  { label: "Weekly Score", icon: Sparkles, target: "weekly-score" },
  { label: "Score Trends", icon: Activity, target: "score-trends" },
  { label: "Body Composition", icon: Scale, target: "body-composition" },
  { label: "Metabolic", icon: Droplets, target: "metabolic-health" },
  { label: "Sleep", icon: Moon, target: "sleep" },
  { label: "Cardiovascular & Stress", icon: HeartPulse, target: "cardiovascular-stress" },
  { label: "Activity", icon: Activity, target: "activity" },
  { label: "Nutrition", icon: Utensils, target: "nutrition" },
  { label: "Caloric Balance", icon: BarChart3, target: "caloric-balance" },
  { label: "Insulin Resistance", icon: Gauge, target: "insulin-resistance" },
  { label: "Databricks", icon: Database, target: "databricks" },
  { label: "Labs Later", icon: HeartPulse, target: "labs-later" },
];

const chartColors = {
  teal: "#37CFC1",
  orange: "#F59E42",
  blue: "#5DADE2",
  gold: "#FACC15",
  mauve: "#E879F9",
};

const categoryWeights: Record<string, number> = {
  "Body Composition": 20,
  "Metabolic Health": 20,
  Sleep: 23,
  "Cardiovascular & Stress": 25,
  "Activity": 12,
};

function Logo() {
  return (
    <svg aria-label="Weekly Health Command Center" className="size-9 text-primary" viewBox="0 0 48 48" fill="none">
      <path d="M24 5 39.6 14v20L24 43 8.4 34V14L24 5Z" stroke="currentColor" strokeWidth="3" />
      <path d="M16 24h5l3-8 5 16 3-8h4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="3" fill="currentColor" />
    </svg>
  );
}

function AppSidebar({ activeSection, onNavigate }: { activeSection: string; onNavigate: (target: string) => void }) {
  return (
    <Sidebar data-testid="nav-sidebar">
      <SidebarHeader className="gap-3 px-4 py-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Weekly Health</p>
            <p className="truncate text-xs text-muted-foreground">Command Center</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Views</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    isActive={activeSection === item.target}
                    onClick={() => onNavigate(item.target)}
                    data-testid={`nav-${item.label.toLowerCase().replaceAll(" ", "-")}`}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-4 py-4">
        <div className="rounded-md bg-sidebar-accent p-3">
          <p className="text-xs font-medium">Cadence</p>
          <p className="mt-1 text-xs text-muted-foreground">Runs Fridays at 3 PM PT against Databricks weekly rollups.</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <Button size="icon" variant="ghost" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} data-testid="button-theme-toggle" onClick={() => setDark((value) => !value)}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function formatValue(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  const rounded = Math.abs(value) >= 100 || unit === "cal" || unit === "steps" ? Math.round(value) : Math.abs(value) < 1 ? Number(value.toFixed(2)) : Number(value.toFixed(1));
  const formatted = Math.abs(rounded) >= 1000 ? rounded.toLocaleString() : Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(Math.abs(rounded) < 1 ? 2 : 1);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function formatDelta(delta: number | null) {
  if (delta === null) return "—";
  const abs = Math.abs(delta) >= 1000 ? Math.abs(delta).toLocaleString() : Math.abs(delta).toFixed(delta % 1 === 0 ? 0 : 1);
  return `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${abs}`;
}

function formatRefreshTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function statusClass(status: string, band?: string) {
  if (band === "green") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (band === "yellow") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (band === "red") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (status.includes("Deficit")) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function barColor(band?: string) {
  if (band === "green") return "bg-green-400";
  if (band === "yellow") return "bg-yellow-400";
  if (band === "red") return "bg-red-400";
  if (band === "missing") return "bg-slate-600";
  if (band === "neutral") return "bg-sky-400";
  return "bg-muted-foreground";
}

const sparklineDomains: Record<string, { min: number; max: number }> = {
  "Weight": { min: 130, max: 180 },
  "Body Fat": { min: 0, max: 20 },
  "Visceral Fat": { min: 0, max: 5 },
  "Cellular Water Ratio": { min: 120, max: 160 },
  "Glucose": { min: 50, max: 130 },
  "Ketones": { min: 0, max: 2.5 },
  "Insulin Load": { min: 0, max: 275 },
  "Total Sleep": { min: 3, max: 9 },
  "Sleep Efficiency": { min: 60, max: 100 },
  "Sleep Score": { min: 50, max: 100 },
  "Heart Rate Variability": { min: 0, max: 60 },
  "Resting HR": { min: 50, max: 100 },
  "Stress Level": { min: 0, max: 6 },
  "Resilience": { min: 0, max: 6 },
  "Steps": { min: 0, max: 15000 },
  "Vo2max": { min: 30, max: 60 },
  "Fat": { min: 0, max: 250 },
  "Protein": { min: 0, max: 250 },
  "Net Carbs": { min: 0, max: 150 },
};

function DailySparkBars({ metric }: { metric: Pick<CoreMetric, "name" | "value" | "unit" | "band" | "status" | "dailyValues"> }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const values = metric.dailyValues ?? [];
  const displayValues = values.length ? values : Array.from({ length: 7 }, (_, index) => ({
    date: `D${index + 1}`,
    value: metric.value,
    band: metric.band,
    status: metric.status,
  }));
  const domain = sparklineDomains[metric.name];
  const activeItem = activeIndex !== null ? displayValues[activeIndex] : null;

  function formatSparkDate(date: string) {
    if (!date || date.startsWith("D")) return date;
    const parsed = new Date(`${date}T00:00:00Z`);
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  return (
    <div className="relative flex h-8 items-end justify-end gap-1" aria-label={`${metric.name} current 7-day daily values`}>
      {activeItem ? (
        <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 min-w-36 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs shadow-lg">
          <p className="font-medium">{formatSparkDate(activeItem.date)}</p>
          <p className="mt-1 font-mono text-sm">
            {activeItem.value === null ? "No data" : formatValue(activeItem.value, metric.unit)}
          </p>
          <p className={`mt-1 ${activeItem.band === "green" ? "text-green-300" : activeItem.band === "yellow" ? "text-yellow-300" : activeItem.band === "red" ? "text-red-300" : "text-muted-foreground"}`}>
            {activeItem.status ?? metric.status}
          </p>
        </div>
      ) : null}
      {displayValues.map((item, index) => {
        const value = item.value ?? domain?.min ?? 0;
        const normalized = item.value === null
          ? 0
          : domain
          ? Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)))
          : 0.65;
        const height = item.value === null ? 25 : 35 + normalized * 55;
        return (
          <span
            key={`${item.date}-${index}`}
            role="button"
            tabIndex={0}
            className={`w-2 rounded-sm outline-none ring-offset-2 ring-offset-background transition-all hover:opacity-80 focus:ring-2 focus:ring-primary ${activeIndex === index ? "opacity-100" : "opacity-90"} ${barColor(item.band)}`}
            style={{ height: `${height}%` }}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
            onClick={() => setActiveIndex(activeIndex === index ? null : index)}
            aria-label={item.value === null ? `${metric.name} ${item.date}: No data` : `${metric.name} ${item.date}: ${formatValue(item.value, metric.unit)}`}
          />
        );
      })}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function WeightedScoreTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{label}</p>
      <p style={{ color: payload[0].color }}>
        Points achieved: {formatPoints(item.contribution)} ({formatPoints(item.weight)})
      </p>
      <p className="text-muted-foreground">Target attainment: {item.targetAttainment}%</p>
    </div>
  );
}

function MetricRow({ metric }: { metric: CoreMetric }) {
  const deltaPositive = metric.delta > 0;
  const deltaNegative = metric.delta < 0;
  const tone =
    metric.band === "green" || metric.direction === "positive"
      ? "text-green-400"
      : metric.band === "red" || metric.direction === "warning"
        ? "text-red-400"
        : metric.band === "yellow"
          ? "text-yellow-400"
          : "text-muted-foreground";

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border/70 py-3 last:border-0 md:grid-cols-[1.1fr_0.8fr_0.7fr_0.9fr] md:gap-3" data-testid={`row-metric-${metric.name.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{metric.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">Prior: {formatValue(metric.priorValue, metric.unit)}</p>
      </div>
      <div className="text-right md:text-left">
        <p className="font-mono text-base font-semibold md:text-lg">{formatValue(metric.value, metric.unit)}</p>
      </div>
      <div className={`flex items-center gap-1 font-mono text-sm ${tone}`}>
        {deltaPositive ? <ArrowUp className="size-3" /> : deltaNegative ? <ArrowDown className="size-3" /> : null}
        {formatDelta(metric.delta)}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Badge variant="outline" className={statusClass(metric.status, metric.band)}>{metric.status}</Badge>
        <div className="w-16">
          <DailySparkBars metric={metric} />
        </div>
      </div>
    </div>
  );
}

function NutritionRow({ metric }: { metric: NutritionMetric }) {
  const status = metric.status ?? "Tracked";
  const band = metric.band ?? "neutral";
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border/70 py-3 last:border-0 md:grid-cols-[1.1fr_0.8fr_0.7fr_0.9fr] md:gap-3" data-testid={`row-nutrition-${metric.name.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{metric.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">Prior: {formatValue(metric.priorValue, metric.unit)}</p>
      </div>
      <div className="text-right md:text-left">
        <p className="font-mono text-base font-semibold md:text-lg">{formatValue(metric.value, metric.unit)}</p>
      </div>
      <div className={`flex items-center gap-1 font-mono text-sm ${metric.delta > 0 ? "text-sky-300" : metric.delta < 0 ? "text-muted-foreground" : "text-muted-foreground"}`}>
        {metric.delta > 0 ? <ArrowUp className="size-3" /> : metric.delta < 0 ? <ArrowDown className="size-3" /> : null}
        {formatDelta(metric.delta)}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Badge variant="outline" className={statusClass(status, band)}>{status}</Badge>
        <div className="w-16">
          <DailySparkBars metric={{ ...metric, band, status }} />
        </div>
      </div>
    </div>
  );
}

function MacroCaloriePie({ metrics }: { metrics: NutritionMetric[] }) {
  const fat = metrics.find((metric) => metric.name === "Fat")?.value ?? 0;
  const protein = metrics.find((metric) => metric.name === "Protein")?.value ?? 0;
  const netCarbs = metrics.find((metric) => metric.name === "Net Carbs")?.value ?? 0;
  const data = [
    { name: "Fat", calories: fat * 9, color: chartColors.orange },
    { name: "Protein", calories: protein * 4, color: chartColors.teal },
    { name: "Net Carbs", calories: netCarbs * 4, color: chartColors.blue },
  ].filter((item) => item.calories > 0);
  const total = data.reduce((sum, item) => sum + item.calories, 0);
  const fatPercent = total ? (fat * 9) / total : 0;
  const fatBand = fatPercent > 0.8 ? "green" : fatPercent >= 0.6 ? "yellow" : "red";
  const fatStatus = fatPercent > 0.8 ? "Above Target" : fatPercent >= 0.6 ? "On Target" : "Below Target";

  if (!total) return null;

  return (
    <div className="mt-5 rounded-md bg-muted p-4" data-testid="chart-macro-calories">
      <div className="mb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Macro calorie split</p>
            <p className="text-xs text-muted-foreground">Calculated as fat × 9, protein × 4, net carbs × 4.</p>
          </div>
          <Badge variant="outline" className={statusClass(fatStatus, fatBand)}>
            Fat {Math.round(fatPercent * 100)}%
          </Badge>
        </div>
      </div>
      <div className="grid items-center gap-3 md:grid-cols-[0.8fr_1fr]">
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="calories" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
                {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [`${Math.round(value).toLocaleString()} cal`, name]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {data.map((item) => (
            <div key={item.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <i className="block size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name}
              </span>
              <span className="font-mono">{Math.round((item.calories / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NutritionCard({ metrics }: { metrics: NutritionMetric[] }) {
  return (
    <Card id="nutrition" className="scroll-mt-20" data-testid="card-nutrition">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><Utensils className="size-5" />Nutrition</CardTitle>
        <p className="text-sm text-muted-foreground">Daily Cronometer macros. These are tracked but not scored until target ranges are defined.</p>
      </CardHeader>
      <CardContent>
        {metrics.length ? (
          <>
            {metrics.map((metric) => <NutritionRow key={metric.name} metric={metric} />)}
            <MacroCaloriePie metrics={metrics} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No Cronometer nutrition rows found for Fat, Protein, or Net Carbs in the current window.</p>
        )}
      </CardContent>
    </Card>
  );
}

function irScoreClass(score: number) {
  if (score <= 12) return "border-green-500/30 bg-green-500/10 text-green-300";
  if (score <= 24) return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (score <= 35) return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function irComponentScoreClass(score: number) {
  if (score <= 0) return "border-green-500/30 bg-green-500/10 text-green-300";
  if (score === 1) return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (score === 2) return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function InsulinResistanceCard({ data }: { data: WeeklyReport["insulinResistance"] }) {
  if (!data) return null;
  const topDrivers = [...data.components].sort((a, b) => b.score - a.score).slice(0, 5);
  const isSnapshot = data.source !== "databricks";
  const overlayedMetrics = data.overlayedMetrics ?? [];
  const overlaySet = new Set(overlayedMetrics);
  const overlayNote = overlayedMetrics.length > 0
    ? ` Live values overlaid for ${overlayedMetrics.join(", ")} (component scores still from snapshot).`
    : "";
  const description = isSnapshot
    ? `Development fallback: static IRS v2 snapshot (resultDate ${data.resultDate}). Databricks was unavailable, so values are not live; newer lab values upstream may not be reflected.${overlayNote}`
    : "Live IRS score and component values sourced from Databricks (workspace.default.irs_long_latest).";
  return (
    <Card id="insulin-resistance" className="scroll-mt-20" data-testid="card-insulin-resistance">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><Gauge className="size-5" />Insulin Resistance Score</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-[0.65fr_1.35fr]">
          <div className="rounded-md bg-muted p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total score</p>
            <p className="mt-3 font-mono text-5xl font-semibold text-primary">{data.score}<span className="text-2xl text-muted-foreground">/54</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline" className={irScoreClass(data.score)}>{data.range || "Range"}</Badge>
              <Badge variant="secondary">{data.resultDate}</Badge>
              {isSnapshot
                ? <Badge variant="outline">Fallback snapshot</Badge>
                : <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Databricks</Badge>}
            </div>
          </div>
          <div className="rounded-md bg-muted p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Top Areas of Impact</p>
            <div className="mt-3 grid gap-2">
              {topDrivers.map((item) => (
                <div key={item.metric} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{item.metric}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">{formatValue(item.value, "")}</span>
                    <Badge variant="outline" className={irComponentScoreClass(item.score)}>{item.score}</Badge>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {data.components.map((item) => (
            <div key={item.metric} className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-3 text-sm">
              <span className="truncate">{item.metric}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground">{formatValue(item.value, "")}</span>
                {overlaySet.has(item.metric) ? <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Live</Badge> : null}
                <Badge variant="outline" className={irComponentScoreClass(item.score)}>{item.score}</Badge>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-3" data-testid="dashboard-loading">
      {Array.from({ length: 9 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="p-5">
            <div className="h-4 w-24 rounded-md bg-muted" />
            <div className="mt-5 h-8 w-32 rounded-md bg-muted" />
            <div className="mt-5 h-24 rounded-md bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function WeeklyDashboard() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery<WeeklyReport>({
    queryKey: ["/api/health/overview"],
    queryFn: async () => {
      if (window.location.protocol === "file:") return fallbackReport;

      try {
        const response = await apiRequest("GET", "/api/health/overview");
        return (await response.json()) as WeeklyReport;
      } catch {
        return fallbackReport;
      }
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, CoreMetric[]>();
    for (const metric of data?.coreMetrics ?? []) {
      groups.set(metric.group, [...(groups.get(metric.group) ?? []), metric]);
    }
    return Array.from(groups.entries());
  }, [data]);

  const activityGroup = useMemo(() => grouped.find(([group]) => group === "Activity"), [grouped]);
  const primaryMetricGroups = useMemo(() => grouped.filter(([group]) => group !== "Activity"), [grouped]);

  const scoreByGroup = useMemo(() => {
    return grouped.map(([group, metrics]) => {
      const weight = categoryWeights[group] ?? 0;
      const targetAttainment = metrics.reduce((sum, metric) => sum + metric.scoreImpact, 0) / (metrics.length * 5);
      return {
        group,
        weight,
        contribution: Number((weight * targetAttainment).toFixed(1)),
        targetAttainment: Math.round(targetAttainment * 100),
      };
    });
  }, [grouped]);

  const totalWeight = useMemo(() => scoreByGroup.reduce((sum, item) => sum + item.weight, 0), [scoreByGroup]);
  const totalContribution = useMemo(() => Number(scoreByGroup.reduce((sum, item) => sum + item.contribution, 0).toFixed(1)), [scoreByGroup]);
  const displayedScore = Math.round(totalContribution);
  const displayedScoreBand = displayedScore >= 90 ? "Optimal" : displayedScore >= 75 ? "Good" : "Needs Work";
  const databricksStatus = data?.mode.includes("live")
    ? "Databricks live"
    : data?.mode.includes("export") || data?.mode.includes("snapshot")
      ? "Databricks snapshot"
      : "Databricks env pending";

  async function handleRefresh() {
    if (window.location.protocol === "file:") {
      setRefreshMessage("Standalone HTML cannot query Databricks directly. Use the hosted app/server for refresh.");
      return;
    }

    setRefreshing(true);
    setRefreshMessage(null);

    try {
      const response = await apiRequest("POST", "/api/health/refresh?force=true");
      const payload = await response.json();
      if (payload.report) {
        queryClient.setQueryData(["/api/health/overview"], payload.report);
      }
      const refreshedReport = payload.report as WeeklyReport | undefined;
      const sameWindow = Boolean(refreshedReport && refreshedReport.displayedRange === data?.displayedRange);
      const baseMessage = payload.message ?? (payload.refreshed ? "Refreshed from Databricks." : "Using latest exported snapshot.");
      setRefreshMessage(
        refreshedReport && sameWindow
          ? `${baseMessage} Latest Databricks data still ends at ${refreshedReport.displayedRange}, so the dashboard values did not change.`
          : baseMessage
      );
    } catch {
      setRefreshMessage("Refresh failed. Check server Databricks credentials and warehouse access.");
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !data) {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
            <h1 className="mt-4 text-xl font-semibold">Weekly report unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">The dashboard API did not return weekly health data.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-50 flex min-h-16 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur md:gap-3 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold md:text-xl">Weekly Health Command Center</h1>
            <p className="truncate text-sm text-muted-foreground">
              Current: {data.currentWindow} · Compared with: {data.priorWindow} · Last refreshed {formatRefreshTime(data.updatedAt)}
              {data.latestDataDate ? ` · Latest data ${data.latestDataDate}` : ""}
              {typeof data.latestDataLagDays === "number" && data.latestDataLagDays > 1
                ? ` (${data.latestDataLagDays} days behind today)`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {typeof data.latestDataLagDays === "number" && data.latestDataLagDays > 2 ? (
            <Badge variant="destructive" data-testid="status-data-stale">
              Data {data.latestDataLagDays}d stale
            </Badge>
          ) : null}
          <Badge variant={databricksStatus === "Databricks live" ? "default" : "secondary"} data-testid="status-databricks">
            {databricksStatus}
          </Badge>
          <ThemeToggle />
        </div>
      </header>

      <nav className="sticky top-16 z-40 flex gap-2 overflow-x-auto border-b bg-background/95 px-3 py-2 backdrop-blur md:hidden" aria-label="Mobile section navigation">
        {navItems.map((item) => (
          <Button
            key={item.target}
            size="sm"
            variant={item.target === "weekly-score" ? "secondary" : "ghost"}
            className="shrink-0"
            onClick={() => document.getElementById(item.target)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            data-testid={`mobile-nav-${item.label.toLowerCase().replaceAll(" ", "-")}`}
          >
            <item.icon className="size-4" />
            {item.label}
          </Button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto overscroll-contain p-3 md:p-6" data-testid="main-dashboard">
        <section id="weekly-score" className="scroll-mt-20 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="overflow-hidden" data-testid="card-weekly-score">
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-primary/30 via-card to-indigo-950/40 p-4 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary md:text-xs md:tracking-[0.32em]">{data.organization}</p>
                    <h2 className="mt-3 text-lg font-semibold md:text-xl">Weekly Health Report</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{data.person} · {data.displayedRange}</p>
                  </div>
                  <Badge variant="outline" className="border-primary/40 text-primary">{displayedScoreBand}</Badge>
                </div>
                <div className="mt-6 flex items-end justify-between gap-5 md:mt-8">
                  <div>
                    <p className="font-mono text-5xl font-semibold leading-none text-primary md:text-6xl">{displayedScore}</p>
                    <p className="mt-2 text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">Weekly Health Score</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-2xl font-semibold text-emerald-400">+{data.scoreDelta}</p>
                    <p className="text-xs text-muted-foreground">vs prior 7 days</p>
                  </div>
                </div>
                <div className="mt-6">
                  <Progress value={displayedScore} />
                  <div className="mt-2 flex justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                    <span>Needs Work</span><span>Good</span><span>Optimal</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            <Card data-testid="card-top-wins">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Trophy className="size-5 text-emerald-400" />Top 3 wins</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 md:space-y-3">
                {data.wins.map((win) => (
                  <div key={win.metric} className="rounded-md bg-emerald-500/10 p-3">
                    <p className="text-sm font-semibold">{win.metric}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{win.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card data-testid="card-focus-areas">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Activity className="size-5 text-amber-400" />Focus areas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 md:space-y-3">
                {data.focusAreas.map((area) => (
                  <div key={area.metric} className="rounded-md bg-amber-500/10 p-3">
                    <p className="text-sm font-semibold">{area.metric}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{area.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="score-trends" className="scroll-mt-20 mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card data-testid="chart-score-trend">
            <CardHeader>
              <CardTitle className="text-lg">7-day signal trend</CardTitle>
              <p className="text-sm text-muted-foreground">Normalized 0-100 week trend indexes so mixed units can be compared safely.</p>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-2"><i className="block size-2 rounded-full" style={{ backgroundColor: chartColors.teal }} />Score</span>
                <span className="flex items-center gap-2"><i className="block h-0.5 w-4" style={{ backgroundColor: chartColors.orange }} />Glucose index</span>
                <span className="flex items-center gap-2"><i className="block size-2 rounded-full" style={{ backgroundColor: chartColors.blue }} />Sleep score</span>
                <span className="flex items-center gap-2"><i className="block h-0.5 w-4 border-t-2 border-dotted" style={{ borderColor: chartColors.gold }} />HRV index</span>
              </div>
              <div className="h-56 md:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.scoreTrend}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="score" name="Score" stroke={chartColors.teal} strokeWidth={3} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="glucoseIndex" name="Glucose index" stroke={chartColors.orange} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="sleepScore" name="Sleep" stroke={chartColors.blue} strokeWidth={2.5} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="hrvIndex" name="HRV index" stroke={chartColors.gold} strokeWidth={2.5} strokeDasharray="2 4" dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="chart-group-score">
            <CardHeader>
              <CardTitle className="text-lg">Weighted score contribution</CardTitle>
              <p className="text-sm text-muted-foreground">Category weights total {totalWeight}%. Bars show achieved points toward the weekly score.</p>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">Achieved: {totalContribution}/100</Badge>
                <Badge variant="outline">Weights sum: {totalWeight}%</Badge>
              </div>
              <div className="h-56 md:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scoreByGroup} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" domain={[0, 30]} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis type="category" dataKey="group" width={130} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip content={<WeightedScoreTooltip />} />
                  <Bar dataKey="contribution" name="Achieved points" radius={[0, 5, 5, 0]}>
                    {scoreByGroup.map((entry) => (
                      <Cell key={entry.group} fill={entry.targetAttainment >= 80 ? chartColors.teal : entry.targetAttainment >= 60 ? chartColors.gold : chartColors.mauve} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The rounded dashboard score is {displayedScore}; underlying weighted points are {totalContribution}/100.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-2">
          {primaryMetricGroups.map(([group, metrics]) => (
            <Card
              key={group}
              id={
                group === "Body Composition"
                  ? "body-composition"
                  : group === "Metabolic Health"
                    ? "metabolic-health"
                    : group === "Sleep"
                      ? "sleep"
                      : group === "Cardiovascular & Stress"
                        ? "cardiovascular-stress"
                        : group === "Activity"
                          ? "activity"
                          : undefined
              }
              className="scroll-mt-20"
              data-testid={`card-group-${group.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
              {group === "Body Composition" ? <Scale className="size-5" /> : group === "Metabolic Health" ? <Droplets className="size-5" /> : group === "Sleep" ? <Moon className="size-5" /> : group === "Cardiovascular & Stress" ? <HeartPulse className="size-5" /> : <Activity className="size-5" />}
                  {group}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.map((metric) => <MetricRow key={metric.name} metric={metric} />)}
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="grid gap-4">
            {activityGroup ? (
              <Card
                id="activity"
                className="scroll-mt-20"
                data-testid="card-group-activity"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Activity className="size-5" />
                    Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activityGroup[1].map((metric) => <MetricRow key={metric.name} metric={metric} />)}
                </CardContent>
              </Card>
            ) : null}
            <Card id="caloric-balance" className="scroll-mt-20" data-testid="card-caloric-balance">
              <CardHeader>
                <CardTitle className="text-lg">Caloric Balance</CardTitle>
                <p className="text-sm text-muted-foreground">Supporting metrics outside the 16 core tracking metrics.</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.supportMetrics.map((metric) => (
                  <div key={metric.name} className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
                    <div>
                      <p className="text-sm font-medium">{metric.name}</p>
                      <p className="text-xs text-muted-foreground">{metric.status}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-semibold">{formatValue(metric.value, metric.unit)}</p>
                      {metric.delta !== null ? <p className="font-mono text-xs text-muted-foreground">{formatDelta(metric.delta)} vs prior</p> : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          <NutritionCard metrics={data.nutritionMetrics ?? []} />
        </section>

        <section className="mt-4">
          <InsulinResistanceCard data={data.insulinResistance} />
        </section>

        <section className="mt-4">
          <Card id="databricks" className="scroll-mt-20" data-testid="card-databricks-contract">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg"><Database className="size-5" />Databricks weekly contract</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Current window uses past 7 days and compares against the 7 days immediately before it.</p>
              </div>
              <Button variant="outline" size="sm" data-testid="button-refresh" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing" : "Refresh"}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md bg-muted p-4">
                <CalendarClock className="size-5 text-primary" />
                <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Schedule</p>
                <p className="mt-1 text-sm font-medium">{data.cadence}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{data.databricks.schedule}</p>
              </div>
              <div className="rounded-md bg-muted p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sources</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.sources.map((source) => <Badge key={source} variant="secondary">{source}</Badge>)}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{data.processingNote}</p>
              </div>
              <div className="rounded-md bg-muted p-4">
                <div id="labs-later" className="scroll-mt-20" />
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Future modules</p>
                <p className="mt-2 text-sm text-muted-foreground">Blood work, functional tests, medication/supplement adherence, and experiment annotations can slot in as new groups.</p>
              </div>
              {refreshMessage ? (
                <div className="rounded-md bg-muted p-4 md:col-span-3" data-testid="status-refresh-message">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Refresh status</p>
                  <p className="mt-2 text-sm">{refreshMessage}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={WeeklyDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [activeSection, setActiveSection] = useState("weekly-score");
  const sidebarStyle = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "4rem",
  } as CSSProperties;

  function navigateToSection(target: string) {
    setActiveSection(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={sidebarStyle}>
          <div className="flex h-screen w-full">
            <AppSidebar activeSection={activeSection} onNavigate={navigateToSection} />
            <SidebarInset>
              <Router hook={useHashLocation}>
                <AppRouter />
              </Router>
            </SidebarInset>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
