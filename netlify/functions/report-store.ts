import { getStore } from "@netlify/blobs";

const store = getStore("weekly-health-command-center");
const latestReportKey = "latest-report";

export async function getStoredReport<T>() {
  try {
    return await store.get(latestReportKey, { type: "json" }) as T | null;
  } catch {
    return null;
  }
}

export async function setStoredReport(report: unknown) {
  await store.setJSON(latestReportKey, {
    ...report as Record<string, unknown>,
    storedAt: new Date().toISOString(),
  });
}
