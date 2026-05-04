import { refreshWeeklyReport } from "../../server/routes";

export const handler = async (event: { httpMethod?: string }) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }

  const result = await refreshWeeklyReport();
  return {
    statusCode: result.statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result.payload),
  };
};
