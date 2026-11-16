import { refreshWeeklyReport } from "../../server/routes";
import { setStoredReport } from "./report-store";

export const config = {
  // Daily at 17:00 UTC = 9:00 AM Pacific (standard time), 30 minutes after
  // Lisa's 8:30 AM summary-table rebuild. 10:00 AM during daylight time.
  schedule: "0 17 * * *",
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
