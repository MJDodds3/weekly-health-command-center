import { getOverviewReport } from "../../server/routes";
import { getStoredReport } from "./report-store";

export const handler = async () => {
  const storedReport = await getStoredReport();
  const report = storedReport ?? await getOverviewReport();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  };
};
