import { refreshWeeklyReport } from "../../server/routes";
import { setStoredReport } from "./report-store";

export const config = {
  schedule: "0 22 * * 5",
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
