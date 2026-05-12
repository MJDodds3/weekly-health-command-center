import { getStore } from "@netlify/blobs";

const latestReportKey = "latest-report";

function getReportStore() {
  return getStore("weekly-health-command-center");
}

export async function getStoredReport<T>() {
  try {
    const store = getReportStore();
    return await store.get(latestReportKey, { type: "json" }) as T | null;
  } catch {
    return null;
  }
}

export async function setStoredReport(report: unknown) {
  try {
    const store = getReportStore();
    await store.setJSON(latestReportKey, {
      ...report as Record<string, unknown>,
      storedAt: new Date().toISOString(),
    });
  } catch {
    // Some Netlify accounts/sites do not expose the Blobs runtime automatically.
    // Refresh should still succeed even if shared persistence is unavailable.
  }
}
