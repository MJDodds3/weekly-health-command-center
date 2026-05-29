import { refreshWeeklyReport } from "../../server/routes";
import { setStoredReport } from "./report-store";

export const handler = async (event: {
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
}) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }

  const queryForce = event.queryStringParameters?.force;
  let bodyForce = false;
  if (event.body) {
    try {
      const parsed = JSON.parse(event.body) as Record<string, unknown>;
      bodyForce = parsed?.force === true;
    } catch {
      // ignore unparseable body
    }
  }
  const force = queryForce === "true" || queryForce === "1" || bodyForce;

  const result = await refreshWeeklyReport({ force });
  if (result.statusCode >= 200 && result.statusCode < 300 && result.payload.report) {
    await setStoredReport(result.payload.report);
  }

  return {
    statusCode: result.statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result.payload),
  };
};
