import { describe, expect, it } from "vitest";
import type { RequestLog } from "../core/types";
import { emptyData } from "../domain/catalog";
import { roleUsageMonitorStats } from "./overview";

const failedLog: RequestLog = {
  id: "failed-request",
  request_id: "failed-request",
  project_id: "admin_playground",
  api_key_id: "",
  model: "test-model",
  status_code: 500,
  latency_ms: 100,
  created_at: "2026-10-28T00:00:00Z",
};

describe("overview summary statistics", () => {
  it("preserves zero request and failure totals when recent logs contain requests outside the summary scope", () => {
    const data = emptyData();
    data.logs = [failedLog];
    expect(roleUsageMonitorStats(data)).toMatchObject({
      requests: 0,
      failedRequests: 0,
      successRequests: 0,
      successRate: 100,
    });
  });

  it("uses aggregate totals rather than the current page of logs, including an explicit zero failure total", () => {
    const data = emptyData();
    data.summary.request_count = 100;
    data.summary.total_tokens = 5000;
    data.summary.estimated_cost_usd = 1.25;
    data.logs = Array.from({ length: 20 }, (_, index) => ({ ...failedLog, id: `request-${index}` }));
    expect(roleUsageMonitorStats(data)).toMatchObject({
      requests: 100,
      failedRequests: 0,
      successRequests: 100,
      successRate: 100,
      totalTokens: 5000,
      cost: 1.25,
    });
  });

  it("derives success rate from aggregate failures and latency from recent requests", () => {
    const data = emptyData();
    data.summary.request_count = 100;
    data.summary.errors = 4;
    data.logs = [failedLog, { ...failedLog, id: "success", status_code: 200, latency_ms: 300 }];
    expect(roleUsageMonitorStats(data)).toMatchObject({
      requests: 100,
      failedRequests: 4,
      successRequests: 96,
      successRate: 96,
      avgLatencyMS: 200,
    });
  });
});
