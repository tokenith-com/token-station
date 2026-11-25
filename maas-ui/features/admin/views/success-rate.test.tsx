import { describe, expect, it } from "vitest";
import { emptyData } from "../domain/catalog";
import { roleUsageMonitorStats } from "./overview";

describe("successful request accounting", () => {
  it("does not count cancellations as successes or infer from paginated logs", () => {
    const data = emptyData();
    data.summary = { ...data.summary, request_count: 6, success_count: 1, errors: 0 };
    data.logs = [];
    expect(roleUsageMonitorStats(data)).toMatchObject({ requests: 6, successRequests: 1, failedRequests: 0 });
    expect(roleUsageMonitorStats(data).successRate).toBeCloseTo(100 / 6);
  });
  it("preserves explicit zero successful requests", () => {
    const data = emptyData();
    data.summary = { ...data.summary, request_count: 6, success_count: 0, errors: 0 };
    expect(roleUsageMonitorStats(data).successRate).toBe(0);
  });
});
