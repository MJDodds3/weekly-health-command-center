import { getWeeklyReport } from "../../server/routes";
import { getStoredReport } from "./report-store";

export const handler = async () => {
  const storedReport = await getStoredReport();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(storedReport ?? getWeeklyReport()),
  };
};
