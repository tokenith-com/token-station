import { useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import type { UsageRange, UsageReport } from "../core/usage-report-types";
import { tx } from "../i18n/runtime";
import { adminFetch, isAuthExpiredError, readAdminError } from "../resources/payloads";

type ReportState = { range: UsageRange; api: ApiContext; report?: UsageReport; error?: string };

export function useUsageReport(api: ApiContext, range: UsageRange) {
  const [result, setResult] = useState<ReportState>();
  const [refreshing, setRefreshing] = useState(true);
  const [revision, setRevision] = useState(0);
  const current = result?.range === range && result.api.baseURL === api.baseURL && result.api.adminToken === api.adminToken ? result : undefined;

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (inFlight) return;
      inFlight = true;
      setRefreshing(true);
      try {
        const response = await adminFetch(api, `/api/admin/usage/report?range=${range}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await readAdminError(response, tx("用量统计加载失败")));
        const payload = await response.json() as UsageReport;
        if (payload.range !== range || !payload.summary || !payload.breakdown || !Array.isArray(payload.timeseries)) {
          throw new Error(tx("用量统计加载失败"));
        }
        if (active) setResult({ range, api, report: payload });
      } catch (reason) {
        if (active && !isAuthExpiredError(reason)) setResult({ range, api, error: reason instanceof Error ? reason.message : tx("用量统计加载失败") });
      } finally {
        inFlight = false;
        if (active) setRefreshing(false);
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => { active = false; controller.abort(); window.clearInterval(interval); };
  }, [api, range, revision]);

  return { report: current?.report, error: current?.error, refreshing, refresh: () => setRevision(value => value + 1) };
}
