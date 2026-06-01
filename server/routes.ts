import type { Express } from "express";
import type { Server } from "node:http";

const databricksReady =
  Boolean(process.env.DATABRICKS_HOST) &&
  Boolean(process.env.DATABRICKS_TOKEN) &&
  Boolean(process.env.DATABRICKS_WAREHOUSE_ID);

const refreshCacheTtlMs = Number(process.env.REFRESH_CACHE_MINUTES ?? 60) * 60 * 1000;
let cachedRefresh:
  | {
      refreshedAt: number;
      report: any;
      rowCount: number;
    }
  | null = null;

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
  "Steps": { group: "Activity", unit: "steps", status: "Above Target", direction: "warning", scoreImpact: 3 },
  "Vo2max": { group: "Activity", unit: "ml/kg/min", status: "On Target", direction: "positive", scoreImpact: 5 },
  "Calories Burned": { unit: "cal", status: "On Target", direction: "neutral", scoreImpact: 5 },
  "Calories Consumed": { unit: "cal", status: "Above Target", direction: "warning", scoreImpact: 3, lowerIsBetter: true },
};

const nutritionMeta: Record<string, { unit: string }> = {
  "Fat": { unit: "g" },
  "Protein": { unit: "g" },
  "Net Carbs": { unit: "g" },
};

type TargetBand = "green" | "yellow" | "red";

const mjdRanges: Record<string, {
  green: string;
  yellow: string;
  red: string;
}> = {
  "Weight": { green: "<150", yellow: "150-160", red: ">160" },
  "Body Fat": { green: "<10", yellow: "10-15", red: ">15" },
  "Visceral Fat": { green: "<1", yellow: "1-3", red: ">3" },
  "Cellular Water Ratio": { green: ">145", yellow: "135-145", red: "<135" },
  "Glucose": { green: "<80", yellow: "80-110", red: ">110" },
  "Ketones": { green: ">1.5", yellow: "0.5-1.5", red: "<0.5" },
  "Insulin Load": { green: "<125", yellow: "125-175", red: ">175" },
  "Total Sleep": { green: ">7", yellow: "5-7", red: "<5" },
  "Sleep Efficiency": { green: ">85", yellow: "75-85", red: "<75" },
  "Sleep Score": { green: ">85", yellow: "70-85", red: "<70" },
  "Heart Rate Variability": { green: ">30", yellow: "20-30", red: "<20" },
  "Resting HR": { green: "<70", yellow: "70-85", red: ">85" },
  "Stress Level": { green: "<2", yellow: "2-4", red: ">4" },
  "Resilience": { green: ">4", yellow: "2-4", red: "<2" },
  "Steps": { green: ">10000", yellow: "7000-10000", red: "<7000" },
  "Vo2max": { green: ">45", yellow: "35-45", red: "<35" },
  "Calories Consumed": { green: "<2500", yellow: "2500-3000", red: ">3000" },
  "Fat": { green: ">200", yellow: "100-200", red: "<100" },
  "Protein": { green: "<100", yellow: "100-175", red: ">175" },
  "Net Carbs": { green: "<20", yellow: "20-50", red: ">50" },
  "% Calories from Fat": { green: ">0.8", yellow: "0.6-0.8", red: "<0.6" },
};

function matchesRange(value: number, expression: string): boolean {
  const expr = expression.replace(/\s/g, "");
  if (expr.startsWith(">")) return value > Number(expr.slice(1));
  if (expr.startsWith("<")) return value < Number(expr.slice(1));
  if (expr.includes("-")) {
    const [a, b] = expr.split("-").map(Number);
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    return value >= low && value <= high;
  }
  return false;
}

function statusFromExpression(expression: string): "Above Target" | "On Target" | "Below Target" {
  const expr = expression.replace(/\s/g, "");
  if (expr.startsWith(">")) return "Above Target";
  if (expr.startsWith("<")) return "Below Target";
  return "On Target";
}

function evaluateTarget(metric: string, value: number): {
  status: "Above Target" | "On Target" | "Below Target";
  band: TargetBand;
  direction: "positive" | "neutral" | "warning";
  scoreImpact: number;
} {
  const ranges = mjdRanges[metric];
  if (!ranges) {
    const fallback = metricMeta[metric] ?? { status: "On Target", direction: "neutral", scoreImpact: 5 };
    return {
      status: fallback.status as "Above Target" | "On Target" | "Below Target",
      band: fallback.direction === "warning" ? "red" : fallback.direction === "neutral" ? "yellow" : "green",
      direction: fallback.direction,
      scoreImpact: fallback.scoreImpact,
    };
  }

  const band: TargetBand = matchesRange(value, ranges.green)
    ? "green"
    : matchesRange(value, ranges.yellow)
      ? "yellow"
      : "red";
  const expression = ranges[band];
  return {
    status: statusFromExpression(expression),
    band,
    direction: band === "green" ? "positive" : band === "yellow" ? "neutral" : "warning",
    scoreImpact: band === "green" ? 5 : band === "yellow" ? 3 : 1,
  };
}

const metricOrder = [
  "Weight", "Body Fat", "Visceral Fat", "Cellular Water Ratio", "Glucose", "Ketones", "Insulin Load",
  "Total Sleep", "Sleep Efficiency", "Sleep Score", "Heart Rate Variability", "Resting HR", "Stress Level",
  "Resilience", "Steps", "Vo2max", "Calories Burned", "Calories Consumed",
];

const focusPriority: Record<string, number> = {
  "Calories Consumed": 1,
  "Insulin Load": 2,
  "Ketones": 3,
  "Heart Rate Variability": 4,
  "Glucose": 5,
  "Total Sleep": 6,
  "Resting HR": 7,
  "Stress Level": 8,
  "Steps": 9,
  "Vo2max": 10,
  "Visceral Fat": 11,
  "Body Fat": 12,
  "Cellular Water Ratio": 13,
  "Weight": 14,
};

function focusSeverity(band?: string) {
  if (band === "red") return 0;
  if (band === "yellow") return 1;
  return 9;
}

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
  { group: "Activity", name: "Steps", value: 10657, unit: "steps", delta: -598, status: "Above Target", direction: "warning", scoreImpact: 3, priorValue: 11255, source: "oura", currentN: 7, priorN: 7 },
  { group: "Activity", name: "Vo2max", value: 44, unit: "ml/kg/min", delta: 0.5, status: "On Target", direction: "positive", scoreImpact: 5, priorValue: 43.5, source: "oura", currentN: 6, priorN: 6 },
].map((metric) => {
  const target = evaluateTarget(metric.name, metric.value);
  const dailyValues = Array.from({ length: 7 }, (_, index) => {
    const date = new Date("2026-05-06T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    const wave = Math.sin(index / 1.8) * Math.max(Math.abs(metric.delta) / 3, Math.abs(metric.value) * 0.015);
    const value = Number((metric.value + wave).toFixed(2));
    return {
      date: date.toISOString().slice(0, 10),
      value,
      ...evaluateTarget(metric.name, value),
    };
  });
  return { ...metric, ...target, dailyValues };
});

const supportMetrics = [
  { name: "Calories Burned", value: 2883.28571429, unit: "cal", delta: -62.28571429, status: "On Target", band: "green", priorValue: 2945.57142857, source: "oura", currentN: 7, priorN: 7 },
  { name: "Calories Consumed", value: 3231, unit: "cal", delta: 535.55714286, ...evaluateTarget("Calories Consumed", 3231), priorValue: 2695.44285714, source: "cronometer", currentN: 6, priorN: 7 },
  { name: "Avg Daily Balance", value: -347.71428571, unit: "cal/day", delta: -597.84285715, status: "Deficit", priorValue: 250.12857143, source: "derived", currentN: 6, priorN: 7 },
];

const nutritionMetrics = [
  { name: "Fat", value: 0, unit: "g", delta: 0, priorValue: 0, source: "cronometer", currentN: 0, priorN: 0, dailyValues: [] },
  { name: "Protein", value: 0, unit: "g", delta: 0, priorValue: 0, source: "cronometer", currentN: 0, priorN: 0, dailyValues: [] },
  { name: "Net Carbs", value: 0, unit: "g", delta: 0, priorValue: 0, source: "cronometer", currentN: 0, priorN: 0, dailyValues: [] },
];

const insulinResistanceSnapshot = {
  score: 7,
  range: "Optimal",
  resultDate: "1Q26",
  source: "data-dictionary" as "data-dictionary" | "databricks",
  overlayedMetrics: [] as string[],
  components: [
    { metric: "Alanine Aminotransferase (ALT)", value: 14, score: 0 },
    { metric: "Apolipoprotein B (Apo-B)", value: 103, score: 2 },
    { metric: "Glucose (Fasting)", value: 98, score: 2 },
    { metric: "Diastolic Blood Pressure", value: 85, score: 0 },
    { metric: "Body Fat (%) - Male", value: 11, score: 0 },
    { metric: "Cortisol (AM, Serum)", value: 10.6, score: 0 },
    { metric: "Hemoglobin A1c (HbA1c)", value: 5.3, score: 1 },
    { metric: "HDL Cholesterol", value: 65, score: 0 },
    { metric: "HOMA-IR", value: 1.4, score: 1 },
    { metric: "hs-CRP", value: 0.3, score: 0 },
    { metric: "Insulin (Fasting)", value: 5.7, score: 1 },
    { metric: "LDL:HDL Ratio", value: 1.85, score: 0 },
    { metric: "Thyroid Stimulating Hormone (TSH)", value: 0.92, score: 0 },
    { metric: "Cholesterol:HDL Ratio", value: 2.7, score: 0 },
    { metric: "Trig:HDL ratio", value: 0.78, score: 0 },
    { metric: "Triglycerides (TG)", value: 51, score: 0 },
    { metric: "Uric Acid", value: 2.7, score: 0 },
    { metric: "Waist:Height", value: 0.46, score: 0 },
  ],
};

// Databricks is the source of truth for IRS. The data-dictionary snapshot is
// only used as a development fallback, opted into explicitly via USE_DD_IRS_V2=true.
const useDataDictionaryIRS = process.env.USE_DD_IRS_V2 === "true";

function insulinResistanceRange(score: number) {
  if (score <= 12) return "Optimal";
  if (score <= 24) return "Mild";
  if (score <= 35) return "Moderate";
  if (score <= 50) return "Severe";
  return "Very Severe";
}

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
  nutritionMetrics,
  insulinResistance: insulinResistanceSnapshot,
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
WITH nutrition_raw AS (
  SELECT
    'Dodds, Matthew' AS Name,
    CAST(timestamp AS DATE) AS Date,
    CAST(fat AS DOUBLE) AS Fat,
    CAST(protein AS DOUBLE) AS Protein,
    CAST(carbohydrate AS DOUBLE) - CAST(fiber AS DOUBLE) AS Net_Carbs,
    'cronometer' AS source
  FROM workspace.default.metric_macronutrients
  WHERE user_uuid IN (
      SELECT DISTINCT user_uuid
      FROM workspace.default.dailytracker_joined
      WHERE last_name = 'Dodds'
        AND first_name = 'Matthew'
        AND user_uuid IS NOT NULL
    )
    AND CAST(timestamp AS DATE) >= date_sub(current_date(), 21)
), nutrition_long AS (
  SELECT Name, Date, 'Fat' AS metric, Fat AS value, source FROM nutrition_raw WHERE Fat IS NOT NULL UNION ALL
  SELECT Name, Date, 'Protein' AS metric, Protein AS value, source FROM nutrition_raw WHERE Protein IS NOT NULL UNION ALL
  SELECT Name, Date, 'Net Carbs' AS metric, Net_Carbs AS value, source FROM nutrition_raw WHERE Net_Carbs IS NOT NULL
), preferences AS (
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
  SELECT 'Stress Level' AS metric, 'oura' AS primary_source UNION ALL
  SELECT 'Fat' AS metric, 'cronometer' AS primary_source UNION ALL
  SELECT 'Protein' AS metric, 'cronometer' AS primary_source UNION ALL
  SELECT 'Net Carbs' AS metric, 'cronometer' AS primary_source
), anchor AS (
  SELECT max(Date) AS anchor_date
  FROM (
    SELECT CAST(dt.date AS DATE) AS Date
    FROM workspace.default.dailytracker_joined dt
    WHERE dt.last_name = 'Dodds'
      AND dt.first_name = 'Matthew'
      AND CAST(dt.date AS DATE) >= date_sub(current_date(), 21)
      AND dt.metric IN (
        'Weight','Body Fat','Visceral Fat','Cellular Water Ratio','Calories Consumed','Insulin Load','Glucose','Ketones',
        'Calories Burned','Steps','Vo2max','Sleep Score','Sleep Efficiency','Resting HR','Resilience','Total Sleep',
        'Heart Rate Variability','Stress Level'
      )
    UNION ALL
    SELECT Date FROM nutrition_long
  )
), ranked AS (
  SELECT
    CONCAT(dt.last_name, ', ', dt.first_name) AS Name,
    CAST(dt.date AS DATE) AS Date,
    CASE
      WHEN lower(dt.metric) IN ('fat','total fat') THEN 'Fat'
      WHEN lower(dt.metric) = 'protein' THEN 'Protein'
      WHEN lower(dt.metric) IN ('net carbs','net carbohydrates','net carbohydrate') THEN 'Net Carbs'
      ELSE dt.metric
    END AS metric,
    dt.value,
    dt.source,
    ROW_NUMBER() OVER (
      PARTITION BY dt.last_name, dt.first_name, CAST(dt.date AS DATE), CASE
        WHEN lower(dt.metric) IN ('fat','total fat') THEN 'Fat'
        WHEN lower(dt.metric) = 'protein' THEN 'Protein'
        WHEN lower(dt.metric) IN ('net carbs','net carbohydrates','net carbohydrate') THEN 'Net Carbs'
        ELSE dt.metric
      END
      ORDER BY
        CASE WHEN prefs.primary_source IS NOT NULL AND dt.source = prefs.primary_source THEN 1 ELSE 2 END,
        CASE WHEN dt.metric = 'Steps' THEN dt.value ELSE NULL END DESC
    ) AS rn
  FROM workspace.default.dailytracker_joined dt
  LEFT JOIN preferences prefs ON CASE
    WHEN lower(dt.metric) IN ('fat','total fat') THEN 'Fat'
    WHEN lower(dt.metric) = 'protein' THEN 'Protein'
    WHEN lower(dt.metric) IN ('net carbs','net carbohydrates','net carbohydrate') THEN 'Net Carbs'
    ELSE dt.metric
  END = prefs.metric
  CROSS JOIN anchor a
  WHERE dt.last_name = 'Dodds'
    AND dt.first_name = 'Matthew'
    AND CAST(dt.date AS DATE) > date_sub(a.anchor_date, 15)
    AND CAST(dt.date AS DATE) <= a.anchor_date
    AND dt.metric IN (
    'Weight','Body Fat','Visceral Fat','Cellular Water Ratio','Calories Consumed','Insulin Load','Glucose','Ketones',
    'Calories Burned','Steps','Vo2max','Sleep Score','Sleep Efficiency','Resting HR','Resilience','Total Sleep',
    'Heart Rate Variability','Stress Level'
  )
  UNION ALL
  SELECT
    Name,
    Date,
    metric,
    value,
    source,
    1 AS rn
  FROM nutrition_long n
  CROSS JOIN anchor a
  WHERE n.Date > date_sub(a.anchor_date, 15)
    AND n.Date <= date_sub(a.anchor_date, 1)
), dedup AS (
  SELECT * FROM ranked WHERE rn = 1 AND Name = 'Dodds, Matthew'
), windows AS (
  SELECT
    d.*,
    a.anchor_date,
    CASE
      WHEN d.metric IN ('Fat','Protein','Net Carbs','Calories Consumed','Calories Burned','Insulin Load') THEN
        CASE
          WHEN d.Date > date_sub(a.anchor_date, 8) AND d.Date <= date_sub(a.anchor_date, 1) THEN 'current_7d'
          WHEN d.Date > date_sub(a.anchor_date, 15) AND d.Date <= date_sub(a.anchor_date, 8) THEN 'prior_7d'
          ELSE 'outside'
        END
      ELSE
        CASE
          WHEN d.Date > date_sub(a.anchor_date, 7) AND d.Date <= a.anchor_date THEN 'current_7d'
          WHEN d.Date > date_sub(a.anchor_date, 14) AND d.Date <= date_sub(a.anchor_date, 7) THEN 'prior_7d'
          ELSE 'outside'
        END
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
  avg(CASE WHEN window_name='current_7d' THEN value END) - avg(CASE WHEN window_name='prior_7d' THEN value END) AS delta,
  to_json(
    array_sort(
      collect_list(named_struct('date', CAST(Date AS STRING), 'value', value))
      FILTER (WHERE window_name='current_7d')
    )
  ) AS daily_values
FROM windows
WHERE window_name IN ('current_7d','prior_7d')
GROUP BY metric
ORDER BY CASE metric
  WHEN 'Weight' THEN 1 WHEN 'Body Fat' THEN 2 WHEN 'Visceral Fat' THEN 3 WHEN 'Cellular Water Ratio' THEN 4
  WHEN 'Glucose' THEN 5 WHEN 'Ketones' THEN 6 WHEN 'Insulin Load' THEN 7 WHEN 'Total Sleep' THEN 8
  WHEN 'Sleep Efficiency' THEN 9 WHEN 'Sleep Score' THEN 10 WHEN 'Heart Rate Variability' THEN 11
  WHEN 'Resting HR' THEN 12 WHEN 'Stress Level' THEN 13 WHEN 'Resilience' THEN 14 WHEN 'Steps' THEN 15
  WHEN 'Vo2max' THEN 16 WHEN 'Calories Burned' THEN 17 WHEN 'Calories Consumed' THEN 18
  WHEN 'Fat' THEN 19 WHEN 'Protein' THEN 20 WHEN 'Net Carbs' THEN 21 ELSE 99 END
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

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function dateAddDays(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
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
      let dailyValues: Array<Record<string, string | number>> = [];
      try {
        dailyValues = typeof row.daily_values === "string" ? JSON.parse(row.daily_values) : [];
      } catch {
        dailyValues = [];
      }
      const dailyByDate = new Map(dailyValues.map((daily) => [String(daily.date), toNumber(daily.value)]));
      const anchorDate = String(row.anchor_date ?? row.current_end ?? "");
      const shifted = name === "Insulin Load";
      const currentEnd = anchorDate ? dateAddDays(anchorDate, shifted ? -1 : 0) : String(row.current_end ?? "");
      const currentStart = currentEnd ? dateAddDays(currentEnd, -6) : String(row.current_start ?? "");
      const filledDailyValues = enumerateDates(currentStart, currentEnd).map((date) => {
        if (!dailyByDate.has(date)) {
          return {
            date,
            value: null,
            status: "No Data",
            band: "missing",
            direction: "neutral",
            scoreImpact: 0,
          };
        }
        const value = toNumber(dailyByDate.get(date));
        return {
          date,
          value,
          ...evaluateTarget(name, value),
        };
      });

      return {
        group: meta.group ?? "Other",
        name,
        value: toNumber(row.current_avg),
        unit: meta.unit,
        delta: toNumber(row.delta),
        ...evaluateTarget(name, toNumber(row.current_avg)),
        priorValue: toNumber(row.prior_avg),
        source: String(row.source ?? ""),
        currentN: toNumber(row.current_n),
        priorN: toNumber(row.prior_n),
        dailyValues: filledDailyValues,
      };
    })
    .sort((a, b) => metricOrder.indexOf(a.name) - metricOrder.indexOf(b.name));

  const nutrition = rows
    .filter((row) => nutritionMeta[String(row.metric)] || String(row.metric) === "Calories Consumed")
    .map((row) => {
      const name = String(row.metric);
      const meta = nutritionMeta[name] ?? { unit: "cal" };
      let dailyValues: Array<Record<string, string | number>> = [];
      try {
        dailyValues = typeof row.daily_values === "string" ? JSON.parse(row.daily_values) : [];
      } catch {
        dailyValues = [];
      }
      const dailyByDate = new Map(dailyValues.map((daily) => [String(daily.date), toNumber(daily.value)]));
      const anchorDate = String(row.anchor_date ?? row.current_end ?? "");
      const currentEnd = anchorDate ? dateAddDays(anchorDate, -1) : String(row.current_end ?? "");
      const currentStart = currentEnd ? dateAddDays(currentEnd, -6) : String(row.current_start ?? "");
      const filledDailyValues = enumerateDates(currentStart, currentEnd).map((date) => {
        if (!dailyByDate.has(date)) return { date, value: null, band: "missing", status: "No Data" };
        const value = toNumber(dailyByDate.get(date));
        return { date, value, ...evaluateTarget(name, value) };
      });
      return {
        name,
        value: toNumber(row.current_avg),
        unit: meta.unit,
        delta: toNumber(row.delta),
        ...evaluateTarget(name, toNumber(row.current_avg)),
        priorValue: toNumber(row.prior_avg),
        source: String(row.source ?? "cronometer"),
        currentN: toNumber(row.current_n),
        priorN: toNumber(row.prior_n),
        dailyValues: filledDailyValues,
      };
    })
    .sort((a, b) => ["Calories Consumed", "Fat", "Protein", "Net Carbs"].indexOf(a.name) - ["Calories Consumed", "Fat", "Protein", "Net Carbs"].indexOf(b.name));

  const support = rows
    .filter((row) => metricMeta[String(row.metric)] && !metricMeta[String(row.metric)]?.group)
    .map((row) => {
      const name = String(row.metric);
      const meta = metricMeta[name];
      return {
        name,
        value: toNumber(row.current_avg),
        unit: meta.unit,
        delta: toNumber(row.delta),
        ...evaluateTarget(name, toNumber(row.current_avg)),
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
      band: value < 0 ? "green" : "red",
      priorValue,
      source: "derived",
      currentN: Math.min(caloriesBurned.currentN, caloriesConsumed.currentN),
      priorN: Math.min(caloriesBurned.priorN, caloriesConsumed.priorN),
    } as any);
  }

  const anchorDates = rows
    .map((row) => String(row.anchor_date ?? ""))
    .filter((value) => value.length > 0)
    .sort();
  const latestDataDate = anchorDates[anchorDates.length - 1] ?? String(rows[0]?.current_end ?? "");
  const todayUtc = new Date().toISOString().slice(0, 10);
  const latestDataLagDays = latestDataDate
    ? Math.max(0, Math.round((Date.parse(`${todayUtc}T00:00:00Z`) - Date.parse(`${latestDataDate}T00:00:00Z`)) / (24 * 60 * 60 * 1000)))
    : null;
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
    ...support
      .filter((metric) => metric.band && metric.band !== "green" && metric.name !== "Avg Daily Balance")
      .map((metric) => ({
        metric: metric.name,
        band: metric.band,
        scoreImpact: metric.band === "red" ? 1 : 3,
        priority: focusPriority[metric.name] ?? 99,
        text: `${formatMetricValue(metric.value, metric.unit)} — ${metric.status}${metric.delta !== null ? ` (${metric.delta > 0 ? "+" : ""}${formatMetricValue(metric.delta, metric.unit)} vs prior week)` : ""}`,
      })),
    ...core
      .filter((metric) => metric.band && metric.band !== "green")
      .map((metric) => ({
        metric: metric.name,
        band: metric.band,
        scoreImpact: metric.scoreImpact,
        priority: focusPriority[metric.name] ?? 99,
        text: `${formatMetricValue(metric.value, metric.unit)} — ${metric.status}${Math.abs(metric.delta) > 0 ? ` (${metric.delta > 0 ? "+" : ""}${formatMetricValue(metric.delta, metric.unit)} vs prior week)` : ""}`,
      })),
  ]
    .sort((a, b) => focusSeverity(a.band) - focusSeverity(b.band) || a.scoreImpact - b.scoreImpact || a.priority - b.priority)
    .slice(0, 4)
    .map(({ metric, text }) => ({ metric, text }));

  return {
    ...weeklyReport,
    mode: "databricks-live",
    updatedAt: new Date().toISOString(),
    currentWindow: formatWindow(currentStart, currentEnd),
    priorWindow: formatWindow(priorStart, priorEnd),
    displayedRange: formatDisplayedRange(currentStart, currentEnd),
    latestDataDate,
    latestDataLagDays,
    score,
    scoreBand,
    scoreDelta: 0,
    wins,
    focusAreas,
    coreMetrics: core,
    supportMetrics: support,
    nutritionMetrics: nutrition,
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

const SNAPSHOT_LIVE_OVERLAY_METRICS = [
  "Alanine Aminotransferase (ALT)",
  "Diastolic Blood Pressure",
];

// Databricks stores ALT under several aliases. Normalize them all to the
// canonical UI metric name so values map onto the v2 component list.
const ALT_METRIC_ALIASES = new Set([
  "alt",
  "alanine aminotransferase",
  "alanine aminotransferase (alt)",
]);

function canonicalIrsMetric(metric: string): string {
  if (ALT_METRIC_ALIASES.has(metric.trim().toLowerCase())) {
    return "Alanine Aminotransferase (ALT)";
  }
  return metric;
}

async function fetchLatestIrsLongValues(metrics: string[]): Promise<Map<string, number>> {
  const overlay = new Map<string, number>();
  if (!databricksReady || metrics.length === 0) return overlay;
  // Expand requested metrics to include any known aliases (e.g. ALT) so the
  // exact-match filter in Databricks does not miss differently-labeled rows.
  const requested = new Set(metrics);
  if (requested.has("Alanine Aminotransferase (ALT)")) {
    requested.add("ALT");
    requested.add("Alanine Aminotransferase");
  }
  const list = Array.from(requested).map((metric) => `'${metric.replace(/'/g, "''")}'`).join(", ");
  try {
    const rows = await executeSql(`
      WITH ranked AS (
        SELECT
          metric,
          try_cast(value AS DOUBLE) AS value,
          ResultDate,
          ROW_NUMBER() OVER (
            PARTITION BY metric
            ORDER BY ResultDate DESC
          ) AS rn
        FROM workspace.default.irs_long_latest
        WHERE lower(LastName) = 'dodds'
          AND metric IN (${list})
          AND value IS NOT NULL
      )
      SELECT metric, value FROM ranked WHERE rn = 1
    `);
    for (const row of rows) {
      const metric = row.metric == null ? "" : canonicalIrsMetric(String(row.metric));
      const value = toNumber(row.value);
      if (metric && Number.isFinite(value)) overlay.set(metric, value);
    }
  } catch {
    // Swallow — caller falls back to snapshot values for any missing metric.
  }
  return overlay;
}

function applySnapshotOverlay(overlay: Map<string, number>) {
  if (overlay.size === 0) return insulinResistanceSnapshot;
  const overlayedMetrics: string[] = [];
  const components = insulinResistanceSnapshot.components.map((component) => {
    if (overlay.has(component.metric)) {
      overlayedMetrics.push(component.metric);
      return { ...component, value: overlay.get(component.metric) as number };
    }
    return component;
  });
  return {
    ...insulinResistanceSnapshot,
    overlayedMetrics,
    components,
  };
}

async function executeInsulinResistanceQuery() {
  if (!databricksReady) return insulinResistanceSnapshot;
  if (useDataDictionaryIRS) {
    // TODO: source live values for additional snapshot metrics once their
    // upstream tables and column names are confirmed. Today we overlay only the
    // metrics whose values are reliably available in workspace.default.irs_long_latest.
    const overlay = await fetchLatestIrsLongValues(SNAPSHOT_LIVE_OVERLAY_METRICS);
    return applySnapshotOverlay(overlay);
  }
  const rows = await executeSql(`
    WITH latest AS (
      SELECT max(ResultDate) AS result_date
      FROM workspace.default.irs_long_latest
      WHERE lower(LastName) = 'dodds'
    ), components AS (
      SELECT metric, try_cast(value AS DOUBLE) AS value, Score, IRS_Score, Range_IRS, ResultDate
      FROM workspace.default.irs_long_latest i
      CROSS JOIN latest l
      WHERE lower(i.LastName) = 'dodds'
        AND i.ResultDate = l.result_date
        AND i.metric IS NOT NULL

      UNION ALL

      SELECT
        'Cholesterol:HDL Ratio' AS metric,
        Total_Choloesterol / HDL_Cholesterol AS value,
        Score_ChoHDL AS Score,
        IRS_Score,
        Range_IRS,
        ResultDate
      FROM workspace.default.irs_df i
      CROSS JOIN latest l
      WHERE lower(i.LastName) = 'dodds'
        AND i.ResultDate = l.result_date
        AND HDL_Cholesterol IS NOT NULL
        AND HDL_Cholesterol != 0
        AND Total_Choloesterol IS NOT NULL
    )
    SELECT metric, value, Score, IRS_Score, Range_IRS, ResultDate
    FROM components
    ORDER BY CASE metric
      WHEN 'Insulin (Fasting)' THEN 1
      WHEN 'Hemoglobin A1c (HbA1c)' THEN 2
      WHEN 'Glucose (Fasting)' THEN 3
      WHEN 'Uric Acid' THEN 4
      WHEN 'HOMA-IR' THEN 5
      WHEN 'Triglycerides (TG)' THEN 6
      WHEN 'HDL Cholesterol' THEN 7
      WHEN 'Trig:HDL ratio' THEN 8
      WHEN 'Thyroid Stimulating Hormone (TSH)' THEN 9
      WHEN 'LDL:HDL Ratio' THEN 10
      WHEN 'Cholesterol:HDL Ratio' THEN 11
      ELSE 99 END
  `);

  let ratioRows = await executeSql(`
    SELECT
      Total_Choloesterol / HDL_Cholesterol AS value,
      Score_ChoHDL AS Score
    FROM workspace.default.irs_df i
    WHERE lower(i.LastName) = 'dodds'
      AND HDL_Cholesterol IS NOT NULL
      AND HDL_Cholesterol != 0
      AND Total_Choloesterol IS NOT NULL
    ORDER BY ResultDate DESC
    LIMIT 1
  `).catch(() => []);

  if (!ratioRows.length) {
    ratioRows = await executeSql(`
      SELECT
        Cholesterol_HDL_Ratio AS value,
        Score_ChoHDL AS Score
      FROM workspace.default.labs_irs_pivot i
      WHERE lower(i.last_name) = 'dodds'
        AND Cholesterol_HDL_Ratio IS NOT NULL
      ORDER BY result_date_time DESC
      LIMIT 1
    `).catch(() => []);
  }

  if (!ratioRows.length) {
    ratioRows = await executeSql(`
      WITH latest AS (
        SELECT max(result_date_time) AS result_date
        FROM workspace.default.labs_joined
        WHERE lower(last_name) = 'dodds'
          AND (
            lower(new_component_name) LIKE '%cholesterol%'
            OR lower(component_name) LIKE '%cholesterol%'
          )
      ), values AS (
        SELECT
          max(CASE WHEN lower(new_component_name) LIKE '%total cholesterol%' OR lower(component_name) LIKE '%total cholesterol%' THEN value END) AS total_cholesterol,
          max(CASE WHEN lower(new_component_name) LIKE '%hdl cholesterol%' OR lower(component_name) LIKE '%hdl cholesterol%' THEN value END) AS hdl
        FROM workspace.default.labs_joined l
        CROSS JOIN latest d
        WHERE lower(l.last_name) = 'dodds'
          AND l.result_date_time = d.result_date
      )
      SELECT
        total_cholesterol / hdl AS value,
        CASE WHEN total_cholesterol / hdl <= 4 THEN 0
             WHEN total_cholesterol / hdl <= 4.5 THEN 1
             WHEN total_cholesterol / hdl <= 5 THEN 2
             ELSE 3 END AS Score
      FROM values
      WHERE total_cholesterol IS NOT NULL
        AND hdl IS NOT NULL
        AND hdl != 0
      LIMIT 1
    `).catch(() => []);
  }

  if (!rows.length) return insulinResistanceSnapshot;
  const score = toNumber(rows[0].IRS_Score);
  const components = rows
    .map((row) => ({
      metric: canonicalIrsMetric(String(row.metric)),
      value: toNumber(row.value),
      score: toNumber(row.Score),
    }))
    .filter((row, index, all) => all.findIndex((candidate) => candidate.metric === row.metric) === index);

  if (!components.some((component) => component.metric === "Cholesterol:HDL Ratio") && ratioRows.length) {
    components.splice(10, 0, {
      metric: "Cholesterol:HDL Ratio",
      value: toNumber(ratioRows[0].value),
      score: toNumber(ratioRows[0].Score),
    });
  }

  if (!components.some((component) => component.metric === "Cholesterol:HDL Ratio")) {
    const totalCholesterol = toNumber(rows.find((row) => String(row.metric).toLowerCase().includes("total") && String(row.metric).toLowerCase().includes("cholesterol"))?.value);
    const hdl = toNumber(rows.find((row) => String(row.metric).toLowerCase().includes("hdl"))?.value);
    if (totalCholesterol && hdl) {
      const value = totalCholesterol / hdl;
      components.splice(10, 0, {
        metric: "Cholesterol:HDL Ratio",
        value,
        score: value <= 4 ? 0 : value <= 4.5 ? 1 : value <= 5 ? 2 : 3,
      });
    }
  }

  return {
    score,
    range: insulinResistanceRange(score),
    resultDate: String(rows[0].ResultDate ?? ""),
    source: "databricks" as "data-dictionary" | "databricks",
    overlayedMetrics: [] as string[],
    components,
  };
}

async function executeSql(statement: string): Promise<StatementRow[]> {
  const submit = await databricksRequest("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: process.env.DATABRICKS_WAREHOUSE_ID,
      statement,
      wait_timeout: "10s",
      on_wait_timeout: "CONTINUE",
      format: "JSON_ARRAY",
    }),
  });

  const statementId = submit.statement_id;
  if (!statementId) throw new Error("Databricks did not return a statement_id.");

  let result = submit;
  for (let attempt = 0; attempt < 60; attempt += 1) {
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

export async function refreshWeeklyReport({ force = false }: { force?: boolean } = {}) {
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
    if (!force && cachedRefresh && Date.now() - cachedRefresh.refreshedAt < refreshCacheTtlMs) {
      const minutesRemaining = Math.ceil((refreshCacheTtlMs - (Date.now() - cachedRefresh.refreshedAt)) / 60000);
      const cachedAtIso = new Date(cachedRefresh.refreshedAt).toISOString();
      return {
        statusCode: 200,
        payload: {
          refreshed: true,
          cached: true,
          message: `Using cached Databricks result from ${new Date(cachedRefresh.refreshedAt).toLocaleTimeString()} (warehouse last queried). Cache expires in about ${minutesRemaining} minutes. Use Force refresh to bypass.`,
          report: {
            ...cachedRefresh.report,
            updatedAt: cachedAtIso,
          },
        },
      };
    }

    const [rows, insulinResistance] = await Promise.all([
      executeWeeklyMetricsQuery(),
      executeInsulinResistanceQuery(),
    ]);
    const report = buildReportFromRows(rows);
    report.insulinResistance = insulinResistance;
    cachedRefresh = {
      refreshedAt: Date.now(),
      report,
      rowCount: rows.length,
    };
    const latestDataDate = report.latestDataDate as string | undefined;
    const latestDataLagDays = report.latestDataLagDays as number | null | undefined;
    const lagSuffix =
      typeof latestDataLagDays === "number" && latestDataDate
        ? latestDataLagDays <= 1
          ? ` Latest day in Databricks: ${latestDataDate} (current).`
          : ` Latest day in Databricks is ${latestDataDate} (${latestDataLagDays} days behind today) — newer data may not have synced yet.`
        : "";
    return {
      statusCode: 200,
      payload: {
        refreshed: true,
        message: `Refreshed ${rows.length} metric rows from Databricks.${lagSuffix}`,
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

export async function getOverviewReport() {
  if (process.env.LIVE_OVERVIEW !== "false" && databricksReady) {
    const result = await refreshWeeklyReport();
    if (result.payload.report) return result.payload.report;
  }

  return weeklyReport;
}

export async function searchNutritionSources() {
  if (!databricksReady) return [];
  return executeSql(`
    SELECT table_catalog, table_schema, table_name, column_name, data_type
    FROM system.information_schema.columns
    WHERE lower(table_name) LIKE '%cronometer%'
       OR lower(table_name) LIKE '%nutrition%'
       OR lower(table_name) LIKE '%nutrient%'
       OR lower(column_name) LIKE '%protein%'
       OR lower(column_name) LIKE '%sodium%'
       OR lower(column_name) LIKE '%carb%'
       OR lower(column_name) LIKE '%fat%'
       OR lower(column_name) LIKE '%macro%'
    ORDER BY table_catalog, table_schema, table_name, column_name
    LIMIT 500
  `);
}

export async function searchLabSources() {
  if (!databricksReady) return [];
  return executeSql(`
    SELECT table_catalog, table_schema, table_name, column_name, data_type
    FROM system.information_schema.columns
    WHERE lower(table_name) LIKE '%lab%'
       OR lower(table_name) LIKE '%blood%'
       OR lower(table_name) LIKE '%irs%'
       OR lower(table_name) LIKE '%insulin%'
       OR lower(column_name) LIKE '%component%'
       OR lower(column_name) LIKE '%metric%'
       OR lower(column_name) LIKE '%insulin%'
       OR lower(column_name) LIKE '%hba1c%'
       OR lower(column_name) LIKE '%glucose%'
       OR lower(column_name) LIKE '%triglyceride%'
       OR lower(column_name) LIKE '%hdl%'
       OR lower(column_name) LIKE '%ldl%'
       OR lower(column_name) LIKE '%homa%'
    ORDER BY table_catalog, table_schema, table_name, column_name
    LIMIT 700
  `);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/health/overview", async (_req, res) => {
    res.json(await getOverviewReport());
  });

  app.post("/api/health/refresh", async (req, res) => {
    const force = req.query.force === "true" || req.query.force === "1" || (req.body && (req.body as Record<string, unknown>).force === true);
    const result = await refreshWeeklyReport({ force });
    res.status(result.statusCode).json(result.payload);
  });

  app.get("/api/health/databricks/status", (_req, res) => {
    res.json(weeklyReport.databricks);
  });

  return httpServer;
}
