// Weekly metrics query for the Weekly Health Command Center.
//
// Data sources (moved off Heads Up Health, Nov 2026):
//   Direct APIs built by Lisa Lee
//     - workspace.default.oura_summary      Oura: sleep, HRV, resting HR, steps, calories burned, stress, resilience
//     - workspace.default.whoop_summary     WHOOP: day strain
//     - workspace.default.withings_summary  Withings: weight, body fat, visceral fat, cellular water ratio
//     - emi.dev.apple_health_daily          EMIHealthSync: calories consumed, protein, net carbs, glucose, VO2max, insulin load
//     - emi.dev.keto_mojo_daily             Keto-Mojo: ketones
//
// The emi.dev tables need USE CATALOG / SELECT on `emi` for the dashboard's
// Databricks principal. Until that grant exists, the "emi" variant fails and
// the dashboard falls back to the legacy Heads Up tables for ONLY those metrics
// (dailytracker_joined / metric_macronutrients). Once the grant is in place the
// emi variant succeeds and the legacy tables are no longer read for them.
//
// Fat reads emi.dev.apple_health_daily.Dietary_Fat (added Nov 14, 2026).
//
// Output columns are unchanged from the original query so buildReportFromRows
// keeps working: metric, source, anchor_date, current_start, current_end,
// prior_start, prior_end, current_avg, current_n, prior_avg, prior_n, delta,
// daily_values.

export type WeeklySqlVariant = "direct-full" | "direct-partial";

const ALL_METRICS = [
  "Weight", "Body Fat", "Visceral Fat", "Cellular Water Ratio", "Calories Consumed", "Insulin Load", "Glucose", "Ketones",
  "Calories Burned", "Steps", "Vo2max", "Sleep Score", "Sleep Efficiency", "Resting HR", "Resilience", "Total Sleep",
  "Heart Rate Variability", "Stress Level", "Strain",
];

// Metrics that come from emi.dev tables when the grant exists.
export const EMI_METRICS = ["Calories Consumed", "Insulin Load", "Glucose", "Ketones", "Vo2max", "Protein", "Net Carbs", "Fat"];

const sqlList = (items: string[]) => items.map((item) => `'${item.replace(/'/g, "''")}'`).join(", ");

// Oura and Withings: always direct (workspace catalog).
const ouraWithingsSql = `
  SELECT day AS Date, 'Sleep Score' AS metric, CAST(Sleep_Score AS DOUBLE) AS value, 'oura-api' AS source FROM workspace.default.oura_summary
  UNION ALL SELECT day, 'Total Sleep', CAST(Total_Sleep AS DOUBLE), 'oura-api' FROM workspace.default.oura_summary
  UNION ALL SELECT day, 'Sleep Efficiency', CAST(Sleep_Efficiency AS DOUBLE), 'oura-api' FROM workspace.default.oura_summary
  UNION ALL SELECT day, 'Heart Rate Variability', CAST(HRV AS DOUBLE), 'oura-api' FROM workspace.default.oura_summary
  -- Oura's own resting heart rate (lowest overnight), per Matthew's choice.
  UNION ALL SELECT day, 'Resting HR', CAST(Resting_HR AS DOUBLE), 'oura-api' FROM workspace.default.oura_summary
  UNION ALL SELECT day, 'Steps', CAST(steps AS DOUBLE), 'oura-api' FROM workspace.default.oura_summary
  UNION ALL SELECT day, 'Calories Burned', CAST(calories_burned AS DOUBLE), 'oura-api' FROM workspace.default.oura_summary
  -- Oura reports stress/resilience as words; map to the 1-4/1-5 scale Heads Up used.
  UNION ALL SELECT day, 'Stress Level',
    CASE lower(Stress_Level) WHEN 'restored' THEN 1.0 WHEN 'normal' THEN 2.0 WHEN 'stressful' THEN 4.0 END, 'oura-api'
    FROM workspace.default.oura_summary
  UNION ALL SELECT day, 'Resilience',
    CASE lower(Resilience) WHEN 'limited' THEN 1.0 WHEN 'adequate' THEN 2.0 WHEN 'solid' THEN 3.0 WHEN 'strong' THEN 4.0 WHEN 'exceptional' THEN 5.0 END, 'oura-api'
    FROM workspace.default.oura_summary
  UNION ALL SELECT day, 'Strain', CAST(Strain AS DOUBLE), 'whoop-api' FROM workspace.default.whoop_summary
  UNION ALL SELECT day, 'Weight', CAST(Weight AS DOUBLE), 'withings-api' FROM workspace.default.withings_summary
  UNION ALL SELECT day, 'Body Fat', CAST(Body_Fat AS DOUBLE), 'withings-api' FROM workspace.default.withings_summary
  UNION ALL SELECT day, 'Visceral Fat', CAST(Visceral_Fat AS DOUBLE), 'withings-api' FROM workspace.default.withings_summary
  -- Withings stores the ratio (1.39); the dashboard targets use x100 (139).
  UNION ALL SELECT day, 'Cellular Water Ratio', CAST(Cellular_Water_Ratio AS DOUBLE) * 100, 'withings-api' FROM workspace.default.withings_summary
`;

// Apple Health (EMIHealthSync) and Keto-Mojo: direct once emi grant exists.
const emiSql = `
  UNION ALL SELECT day, 'Calories Consumed', CAST(Calories_Consumed AS DOUBLE), 'apple-health' FROM emi.dev.apple_health_daily
  UNION ALL SELECT day, 'Protein', CAST(Protein AS DOUBLE), 'apple-health' FROM emi.dev.apple_health_daily
  UNION ALL SELECT day, 'Fat', CAST(Dietary_Fat AS DOUBLE), 'apple-health' FROM emi.dev.apple_health_daily
  UNION ALL SELECT day, 'Net Carbs', CAST(Carbohydrates AS DOUBLE) - coalesce(CAST(Fiber AS DOUBLE), 0), 'apple-health' FROM emi.dev.apple_health_daily
  UNION ALL SELECT day, 'Glucose', CAST(Blood_Glucose AS DOUBLE), 'apple-health' FROM emi.dev.apple_health_daily
  UNION ALL SELECT day, 'Vo2max', CAST(VO2max AS DOUBLE), 'apple-health' FROM emi.dev.apple_health_daily
  UNION ALL SELECT day, 'Insulin Load', CAST(Insulin_Load AS DOUBLE), 'apple-health' FROM emi.dev.apple_health_daily
  UNION ALL SELECT date, 'Ketones', CAST(Ketone_Avg AS DOUBLE), 'keto-mojo-api' FROM emi.dev.keto_mojo_daily
`;

export function buildWeeklyMetricsSql(variant: WeeklySqlVariant): string {
  const useEmi = variant === "direct-full";
  // Metrics still read from the legacy Heads Up tables in this variant.
  const legacyTrackerMetrics = useEmi ? [] : ["Calories Consumed", "Insulin Load", "Glucose", "Ketones", "Vo2max"];
  const legacyNutritionMetrics = useEmi ? [] : ["Fat", "Protein", "Net Carbs"];

  const legacyTrackerSql = legacyTrackerMetrics.length === 0 ? "" : `
  UNION ALL
  SELECT Date, metric, value, source FROM (
    SELECT
      CAST(dt.date AS DATE) AS Date, dt.metric, dt.value, dt.source,
      ROW_NUMBER() OVER (
        PARTITION BY CAST(dt.date AS DATE), dt.metric
        ORDER BY CASE
          WHEN dt.metric IN ('Calories Consumed','Insulin Load') AND dt.source = 'cronometer' THEN 1
          WHEN dt.metric IN ('Glucose','Vo2max') AND dt.source = 'healthkit2' THEN 1
          WHEN dt.metric = 'Ketones' AND dt.source = 'mymojohealth' THEN 1
          ELSE 2 END
      ) AS rn
    FROM workspace.default.dailytracker_joined dt
    WHERE dt.last_name = 'Dodds' AND dt.first_name = 'Matthew'
      AND CAST(dt.date AS DATE) >= date_sub(current_date(), 30)
      AND dt.metric IN (${sqlList(legacyTrackerMetrics)})
  ) WHERE rn = 1`;

  const legacyNutritionSql = legacyNutritionMetrics.length === 0 ? "" : `
  UNION ALL
  SELECT Date, metric, value, 'cronometer' AS source FROM (
    SELECT CAST(timestamp AS DATE) AS Date, CAST(fat AS DOUBLE) AS Fat, CAST(protein AS DOUBLE) AS Protein,
           CAST(carbohydrate AS DOUBLE) - CAST(fiber AS DOUBLE) AS Net_Carbs
    FROM workspace.default.metric_macronutrients
    WHERE user_uuid IN (
        SELECT DISTINCT user_uuid FROM workspace.default.dailytracker_joined
        WHERE last_name = 'Dodds' AND first_name = 'Matthew' AND user_uuid IS NOT NULL
      )
      AND CAST(timestamp AS DATE) >= date_sub(current_date(), 30)
  ) LATERAL VIEW stack(3, 'Fat', Fat, 'Protein', Protein, 'Net Carbs', Net_Carbs) s AS metric, value
  WHERE metric IN (${sqlList(legacyNutritionMetrics)})`;

  return `
WITH source_rows AS (
  SELECT CAST(Date AS DATE) AS Date, metric, value, source FROM (
    ${ouraWithingsSql}
    ${useEmi ? emiSql : ""}
    ${legacyTrackerSql}
    ${legacyNutritionSql}
  )
  WHERE value IS NOT NULL AND CAST(Date AS DATE) >= date_sub(current_date(), 30)
), dedup AS (
  -- One value per metric per day (direct tables are already daily; avg guards against duplicates).
  SELECT 'Dodds, Matthew' AS Name, Date, metric, avg(value) AS value, first(source) AS source
  FROM source_rows
  GROUP BY Date, metric
), anchor AS (
  -- Anchor on the latest day with full-day activity or sleep data, so a
  -- partially synced "today" (e.g. only a sleep score) doesn't blank the week.
  SELECT coalesce(
    max(CASE WHEN metric IN ('Steps','Total Sleep','Weight') THEN Date END),
    max(Date)
  ) AS anchor_date
  FROM dedup
  WHERE metric IN (${sqlList([...ALL_METRICS, "Fat", "Protein", "Net Carbs"])})
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
  WHEN 'Vo2max' THEN 16 WHEN 'Strain' THEN 16.5 WHEN 'Calories Burned' THEN 17 WHEN 'Calories Consumed' THEN 18
  WHEN 'Fat' THEN 19 WHEN 'Protein' THEN 20 WHEN 'Net Carbs' THEN 21 ELSE 99 END
`;
}

// Errors that mean "the emi catalog isn't readable yet" — fall back, don't fail.
export function isEmiAccessError(message: string): boolean {
  return /INSUFFICIENT_PERMISSIONS|USE CATALOG|TABLE_OR_VIEW_NOT_FOUND|SCHEMA_NOT_FOUND|CATALOG_NOT_FOUND|emi\.dev/i.test(message);
}
