import { refreshWeeklyReport } from "../../server/routes";
import { setStoredReport } from "./report-store";

export const config = {
  // Twice daily at 17:00 and 05:00 UTC = 9:00 AM and 9:00 PM Pacific (standard
  // time), 30 minutes after the 8:30 AM / 8:30 PM summary-table rebuilds.
  // One hour later during daylight time.
  schedule: "0 5,17 * * *",
};

export const handler = async () => {
  const result = await refreshWeeklyReport();

  if (result.statusCode >= 200 && result.statusCode < 300 && result.payload.report) {
    await setStoredReport(result.payload.report);
  }

  return {
    statusCode: result.statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refreshed: result.payload.refreshed,
      cached: result.payload.cached,
      message: result.payload.message,
      updatedAt: result.payload.report?.updatedAt,
      currentWindow: result.payload.report?.currentWindow,
    }),
  };
};
