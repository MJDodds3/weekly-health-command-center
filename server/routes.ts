import type { Express } from "express";
import type { Server } from "node:http";

const databricksReady =
  Boolean(process.env.DATABRICKS_HOST) &&
  Boolean(process.env.DATABRICKS_TOKEN) &&
  Boolean(process.env.DATABRICKS_WAREHOUSE_ID);

const metricMeta: Record<string, {
  group?: string;
  unit: string;
  status: string;
  direction: "positive" | "neutral" | "warning";
  scoreImpact: number;
  lowerIsBetter?: boolean;
}> = {
  "Weight": { group: "Body Composition", unit: "lb", status: "On Target", direction: "neutral", scoreImpact: 5 },
  "Body Fat": { group: "Body Composition", unit: "%", status: "On Target", direction: "neutral", scoreImpact: 5 },
  "Visceral Fat": { group: "Body Composition", unit: "%", status: "Above Target", direction: "warning", scoreImpact: 3, lowerIsBetter: true },
  "Cellular Water Ratio": { group: "Body Composition", unit: "%", status: "On Target", direction: "neutral", scoreImpact: 5 },
  "Glucose": { group: "Metabolic Health", unit: "mg/dL", status: "On Target", direction: "positive", scoreImpact: 5, lowerIsBetter: true },
  "Ketones": { group: "Metabolic Health", unit: "mmol/L", status: "Below Target", direction: "warning", scoreImpact: 2 },
  "Insulin Load": { group: "Metabolic Health", unit: "g", status: "Above Target", direction: "warning", scoreImpact: 3, lowerIsBetter: true },
  "Total Sleep": { group: "Sleep", unit: "hrs", status: "On Target", direction: "positive", scoreImpact: 5 },
  "Sleep Efficiency": { group: "Sleep", unit: "%", status: "On Target", direction: "neutral", scoreImpact: 5 },
  "Sleep Score": { group: "Sleep", unit: "", status: "On Target", direction: "positive", scoreImpact: 5 },
  "Heart Rate Variability": { group: "Cardiovascular & Stress", unit: "ms", status: "Below Target", direction: "warning", scoreImpact: 2 },
  "Resting HR": { group: "Cardiovascular & Stress", unit: "bpm", status: "On Target", direction: "positive", scoreImpact: 5, lowerIsBetter: true },
  "Stress Level": { group: "Cardiovascular & Stress", unit: "", status: "On Target", direction: "positive", scoreImpact: 5, lowerIsBetter: true },
  "Resilience": { group: "Cardiovascular & Stress", unit: "", status: "On Target", direction: "neutral", scoreImpact: 5 },
  "Steps": { group: "Activity & Nutrition", unit: "steps", status: "Above Target", direction: "warning", scoreImpact: 3 },
  "Vo2max": { group: "Activity & Nutrition", unit: "ml/kg/min", status: "On Target", direction: "positive", scoreImpact: 5 },
  "Calories Burned": { unit: "cal", status: "On Target", direction: "neutral", scoreImpact: 5 },
  "Calories Consumed": { unit: "cal", status: "Above Target", direction: "warning", scoreImpact: 3, lowerIsBetter: true },
};

const metricOrder = [
  "Weight", "Body Fat", "Visceral Fat", "Cellular Water Ratio", "Glucose", "Ketones", "Insulin Load",
  "Total Sleep", "Sleep Efficiency", "Sleep Score", "Heart Rate Variability", "Resting HR", "Stress Level",
  "Resilience", "Steps", "Vo2max", "Calories Burned", "Calories Consumed",
];

const coreMetrics = [
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
  { group: "Activity & Nutrition", name: "Steps", value: 10657, unit: "steps", delta: -598, status: "Above Target", direction: "warning", scoreImpact: 3, priorValue: 11255, source: "oura", currentN: 7, priorN: 7 },
  { group: "Activity & Nutrition", name: "Vo2max", value: 44, unit: "ml/kg/min", delta: 0.5, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 43.5, source: "oura", currentN: 6, priorN: 6 },
];

const supportMetrics = [
  { name: "Calories Burned", value: 2883.28571429, unit: "cal", delta: -62.28571429, status: "On Target", priorValue: 2945.57142857, source: "oura", currentN: 7, priorN: 7 },
  { name: "Calories Consumed", value: 3231, unit: "cal", delta: 535.55714286, status: "Above Target", priorValue: 2695.44285714, source: "cronometer", currentN: 6, priorN: 7 },
  { name: "Avg Daily Balance", value: -347.71428571, unit: "cal/day", delta: -597.84285715, status: "Deficit", priorValue: 250.12857143, source: "derived", currentN: 6, priorN: 7 },
];

const scoreTrend = [
  { date: "04-28", score: 82, glucose: 83, glucoseIndex: 91, sleepScore: 80, hrv: 24, hrvIndex: 68 },
  { date: "04-29", score: 84, glucose: 82, glucoseIndex: 92, sleepScore: 82, hrv: 23, hrvIndex: 66 },
  { date: "04-30", score: 86, glucose: 82, glucoseIndex: 92, sleepScore: 83, hrv: 23, hrvIndex: 66 },
  { date: "05-01", score: 85, glucose: 81, glucoseIndex: 93, sleepScore: 82, hrv: 22, hrvIndex: 64 },
  { date: "05-02", score: 85, glucose: 81, glucoseIndex: 93, sleepScore: 82, hrv: 23, hrvIndex: 66 },
  { date: "05-03", score: 85, glucose: 81, glucoseIndex: 93, sleepScore: 82, hrv: 23, hrvIndex: 66 },
  { date: "05-04", score: 85, glucose: 82, glucoseIndex: 92, sleepScore: 82, hrv: 23, hrvIndex: 66 },
];

const weeklyReport = {
  mode: databricksReady ? "databricks-ready" : "databricks-export",
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
  coreMetrics,
  supportMetrics,
  scoreTrend,
  databricks: {
    ready: true,
    requiredEnv: ["DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID"],
    queryMode: "past_7_days_vs_prior_7_days",
    schedule: "0 22 * * FRI",
    warehouseId: "33ede2bc605f8cd7",
    sourceTable: "workspace.default.dailytracker_joined",
    suggestedTables: [
      "workspace.default.dailytracker_joined",
      "workspace.default.dailyperformance_joined",
      "workspace.default.labs_joined",
      "workspace.default.bodycomp",
      "workspace.default.metabolism",
    ],
  },
};

export function getWeeklyReport() {
  return weeklyReport;
}

const weeklyMetricsSql = `
WITH preferences AS (
  SELECT 'Weight' AS metric, 'withings2' AS primary_source UNION ALL
  SELECT 'Body Fat' AS metric, 'withings2' AS primary_source UNION ALL
  SELECT 'Visceral Fat' AS metric, 'withings2' AS primary_source UNION ALL
  SELECT 'Cellular Water Ratio' AS metric, 'withings2' AS primary_source UNION ALL
  SELECT 'Calories Consumed' AS metric, 'cronometer' AS primary_source UNION ALL
  SELECT 'Insulin Load' AS metric, 'cronometer' AS primary_source UNION ALL
  SELECT 'Glucose' AS metric, 'healthkit2' AS primary_source UNION ALL
  SELECT 'Ketones' AS metric, 'mymojohealth' AS primary_source UNION ALL
  SELECT 'Calories Burned' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Steps' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Vo2max' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Sleep Score' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Sleep Efficiency' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Resting HR' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Resilience' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Total Sleep' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Heart Rate Variability' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Stress Level' AS metric, 'oura' AS primary_source
), ranked AS (
  SELECT
    CONCAT(dt.last_name, ', ', dt.first_name) AS Name,
    CAST(dt.date AS DATE) AS Date,
    dt.metric,
    dt.value,
    dt.source,
    ROW_NUMBER() OVER (
      PARTITION BY dt.last_name, dt.first_name, CAST(dt.date AS DATE), dt.metric
      ORDER BY CASE WHEN prefs.primary_source IS NOT NULL AND dt.source = prefs.primary_source THEN 1 ELSE 2 END
    ) AS rn
  FROM workspace.default.dailytracker_joined dt
  LEFT JOIN preferences prefs ON dt.metric = prefs.metric
  WHERE dt.metric IN (
    'Weight','Body Fat','Visceral Fat','Cellular Water Ratio','Calories Consumed','Insulin Load','Glucose','Ketones',
    'Calories Burned','Steps','Vo2max','Sleep Score','Sleep Efficiency','Resting HR','Resilience','Total Sleep',
    'Heart Rate Variability','Stress Level'
  )
), dedup AS (
  SELECT * FROM ranked WHERE rn = 1 AND Name = 'Dodds, Matthew'
), anchor AS (
  SELECT max(Date) AS anchor_date FROM dedup
), windows AS (
  SELECT
    d.*,
    a.anchor_date,
    CASE
      WHEN d.Date > date_sub(a.anchor_date, 7) AND d.Date <= a.anchor_date THEN 'current_7d'
      WHEN d.Date > date_sub(a.anchor_date, 14) AND d.Date <= date_sub(a.anchor_date, 7) THEN 'prior_7d'
      ELSE 'outside'
    END AS window_name
  FROM dedup d CROSS JOIN anchor a
)
SELECT
  metric,
  first(source) AS source,
  max(anchor_date) AS anchor_date,
  min(CASE WHEN window_name='current_7d' THEN Date END) AS current_start,
  max(CASE WHEN window_name='current_7d' THEN Date END) AS current_end,
  min(CASE WHEN window_name='prior_7d' THEN Date END) AS prior_start,
  max(CASE WHEN window_name='prior_7d' THEN Date END) AS prior_end,
  avg(CASE WHEN window_name='current_7d' THEN value END) AS current_avg,
  count(CASE WHEN window_name='current_7d' THEN 1 END) AS current_n,
  avg(CASE WHEN window_name='prior_7d' THEN value END) AS prior_avg,
  count(CASE WHEN window_name='prior_7d' THEN 1 END) AS prior_n,
  avg(CASE WHEN window_name='current_7d' THEN value END) - avg(CASE WHEN window_name='prior_7d' THEN value END) AS delta
FROM windows
WHERE window_name IN ('current_7d','prior_7d')
GROUP BY metric
ORDER BY CASE metric
  WHEN 'Weight' THEN 1 WHEN 'Body Fat' THEN 2 WHEN 'Visceral Fat' THEN 3 WHEN 'Cellular Water Ratio' THEN 4
  WHEN 'Glucose' THEN 5 WHEN 'Ketones' THEN 6 WHEN 'Insulin Load' THEN 7 WHEN 'Total Sleep' THEN 8
  WHEN 'Sleep Efficiency' THEN 9 WHEN 'Sleep Score' THEN 10 WHEN 'Heart Rate Variability' THEN 11
  WHEN 'Resting HR' THEN 12 WHEN 'Stress Level' THEN 13 WHEN 'Resilience' THEN 14 WHEN 'Steps' THEN 15
  WHEN 'Vo2max' THEN 16 WHEN 'Calories Burned' THEN 17 WHEN 'Calories Consumed' THEN 18 ELSE 99 END
`;

type StatementRow = Record<string, string | number | null>;

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function formatWindow(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const startLabel = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endLabel = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${startLabel}-${endLabel}`;
}

function formatDisplayedRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const startLabel = startDate.toLocaleDateString("en-US", { month: "long", day: "2-digit", timeZone: "UTC" });
  const endLabel = endDate.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "UTC" });
  return `${startLabel} — ${endLabel}`;
}

function formatMetricValue(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 || unit === "cal" || unit === "steps" ? Math.round(value) : Math.abs(value) < 1 ? Number(value.toFixed(2)) : Number(value.toFixed(1));
  const formatted = Math.abs(rounded) >= 1000 ? rounded.toLocaleString() : Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(Math.abs(rounded) < 1 ? 2 : 1);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function beneficialDelta(metric: string, delta: number): number {
  const meta = metricMeta[metric];
  return meta?.lowerIsBetter ? -delta : delta;
}

function buildReportFromRows(rows: StatementRow[]) {
  const core = rows
    .filter((row) => metricMeta[String(row.metric)]?.group)
    .map((row) => {
      const name = String(row.metric);
      const meta = metricMeta[name];
      return {
        group: meta.group,
        name,
        value: toNumber(row.current_avg),
        unit: meta.unit,
        delta: toNumber(row.delta),
        status: meta.status,
        direction: meta.direction,
        scoreImpact: meta.scoreImpact,
        priorValue: toNumber(row.prior_avg),
        source: String(row.source ?? ""),
        currentN: toNumber(row.current_n),
        priorN: toNumber(row.prior_n),
      };
    })
    .sort((a, b) => metricOrder.indexOf(a.name) - metricOrder.indexOf(b.name));

  const support = rows
    .filter((row) => !metricMeta[String(row.metric)]?.group)
    .map((row) => {
      const name = String(row.metric);
      const meta = metricMeta[name];
      return {
        name,
        value: toNumber(row.current_avg),
        unit: meta.unit,
        delta: toNumber(row.delta),
        status: meta.status,
        priorValue: toNumber(row.prior_avg),
        source: String(row.source ?? ""),
        currentN: toNumber(row.current_n),
        priorN: toNumber(row.prior_n),
      };
    });

  const caloriesBurned = support.find((item) => item.name === "Calories Burned");
  const caloriesConsumed = support.find((item) => item.name === "Calories Consumed");
  if (caloriesBurned && caloriesConsumed) {
    const value = caloriesBurned.value - caloriesConsumed.value;
    const priorValue = caloriesBurned.priorValue - caloriesConsumed.priorValue;
    support.push({
      name: "Avg Daily Balance",
      value,
      unit: "cal/day",
      delta: value - priorValue,
      status: value < 0 ? "Deficit" : "Surplus",
      priorValue,
      source: "derived",
      currentN: Math.min(caloriesBurned.currentN, caloriesConsumed.currentN),
      priorN: Math.min(caloriesBurned.priorN, caloriesConsumed.priorN),
    });
  }

  const currentStart = String(rows[0]?.current_start ?? "2026-04-28");
  const currentEnd = String(rows[0]?.current_end ?? "2026-05-04");
  const priorStart = String(rows[0]?.prior_start ?? "2026-04-21");
  const priorEnd = String(rows[0]?.prior_end ?? "2026-04-27");
  const score = Math.round((core.reduce((sum, metric) => sum + metric.scoreImpact, 0) / (core.length * 5)) * 100);
  const scoreBand = score >= 90 ? "Optimal" : score >= 75 ? "Good" : "Needs Work";

  const wins = core
    .map((metric) => ({ metric: metric.name, delta: metric.delta, beneficial: beneficialDelta(metric.name, metric.delta), unit: metric.unit }))
    .filter((metric) => metric.beneficial > 0)
    .sort((a, b) => b.beneficial - a.beneficial)
    .slice(0, 3)
    .map((metric) => ({
      metric: metric.metric,
      text: `Improved by ${formatMetricValue(Math.abs(metric.delta), metric.unit)} vs prior week`,
      delta: metric.delta,
    }));

  const focusAreas = [
    ...support.filter((metric) => metric.status !== "On Target").map((metric) => ({
      metric: metric.name,
      text: `${formatMetricValue(metric.value, metric.unit)} — ${metric.status}${metric.delta !== null ? ` (${metric.delta > 0 ? "+" : ""}${formatMetricValue(metric.delta, metric.unit)} vs prior week)` : ""}`,
    })),
    ...core.filter((metric) => metric.status !== "On Target").map((metric) => ({
      metric: metric.name,
      text: `${formatMetricValue(metric.value, metric.unit)} — ${metric.status}${Math.abs(metric.delta) > 0 ? ` (${metric.delta > 0 ? "+" : ""}${formatMetricValue(metric.delta, metric.unit)} vs prior week)` : ""}`,
    })),
  ].slice(0, 4);

  return {
    ...weeklyReport,
    mode: "databricks-live",
    updatedAt: new Date().toISOString(),
    currentWindow: formatWindow(currentStart, currentEnd),
    priorWindow: formatWindow(priorStart, priorEnd),
    displayedRange: formatDisplayedRange(currentStart, currentEnd),
    score,
    scoreBand,
    scoreDelta: 0,
    wins,
    focusAreas,
    coreMetrics: core,
    supportMetrics: support,
    databricks: {
      ...weeklyReport.databricks,
      ready: true,
      warehouseId: process.env.DATABRICKS_WAREHOUSE_ID,
      sourceTable: "workspace.default.dailytracker_joined",
    },
  };
}

async function databricksRequest(path: string, init?: RequestInit) {
  const host = String(process.env.DATABRICKS_HOST ?? "").replace(/\/$/, "");
  const token = String(process.env.DATABRICKS_TOKEN ?? "");
  const response = await fetch(`${host}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Databricks API ${response.status}: ${text.slice(0, 500)}`);
  }

  return response.json();
}

async function executeWeeklyMetricsQuery(): Promise<StatementRow[]> {
  const submit = await databricksRequest("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: process.env.DATABRICKS_WAREHOUSE_ID,
      statement: weeklyMetricsSql,
      wait_timeout: "10s",
      on_wait_timeout: "CONTINUE",
      format: "JSON_ARRAY",
    }),
  });

  const statementId = submit.statement_id;
  if (!statementId) throw new Error("Databricks did not return a statement_id.");

  let result = submit;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const state = result.status?.state;
    if (state === "SUCCEEDED") break;
    if (state === "FAILED" || state === "CANCELED") throw new Error(`Databricks statement ${state}: ${JSON.stringify(result.status)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = await databricksRequest(`/api/2.0/sql/statements/${statementId}`);
  }

  if (result.status?.state !== "SUCCEEDED") throw new Error("Databricks statement timed out.");

  const columns = result.manifest?.schema?.columns?.map((column: { name: string }) => column.name) ?? [];
  const data = result.result?.data_array ?? [];
  return data.map((row: Array<string | number | null>) => Object.fromEntries(columns.map((column: string, index: number) => [column, row[index]])));
}

export async function refreshWeeklyReport() {
  if (!databricksReady) {
    return {
      statusCode: 200,
      payload: {
        refreshed: false,
        message: "Refresh endpoint is wired, but this server does not have Databricks environment variables configured. Showing latest exported Databricks snapshot.",
        report: {
          ...weeklyReport,
          updatedAt: new Date().toISOString(),
          mode: "databricks-export",
        },
      },
    };
  }

  try {
    const rows = await executeWeeklyMetricsQuery();
    const report = buildReportFromRows(rows);
    return {
      statusCode: 200,
      payload: {
        refreshed: true,
        message: `Refreshed ${rows.length} metric rows from Databricks.`,
        report,
      },
    };
  } catch (error) {
    return {
      statusCode: 502,
      payload: {
        refreshed: false,
        message: error instanceof Error ? error.message : "Databricks refresh failed.",
        report: {
          ...weeklyReport,
          updatedAt: new Date().toISOString(),
          mode: "databricks-refresh-error",
        },
      },
    };
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/health/overview", (_req, res) => {
    res.json(getWeeklyReport());
  });

  app.post("/api/health/refresh", async (_req, res) => {
    const result = await refreshWeeklyReport();
    res.status(result.statusCode).json(result.payload);
  });

  app.get("/api/health/databricks/status", (_req, res) => {
    res.json(weeklyReport.databricks);
  });

  return httpServer;
}
