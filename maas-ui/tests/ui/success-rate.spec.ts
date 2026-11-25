import { capture, expect, test } from "./harness";
import { shellResponses, user } from "./fixtures/shell";

test.use({ sessionUser: { ...user, role: "team_leader" } });
test("success-rate: cancellations are not successful requests", async ({ page, api }, info) => {
  const overview = shellResponses().get("GET /api/admin/overview") as { summary: Record<string, number> };
  api.replaceResponse("GET", "/api/admin/overview", { ...overview, summary: { ...overview.summary, request_count: 6, success_count: 1, errors: 0 } });
  api.respond("GET", "/api/admin/wallet", { balance_micros: 0, available_micros: 0, prepaid_usage: false });
  api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [] } }), query => {
    expect(["", "page=1&page_size=1000&limit=1000"]).toContain(query.toString());
  });
  api.respond("GET", "/api/admin/users", { data: [user] });
  for (const path of ["resources/teams", "resources/announcements", "usage/timeseries"]) api.respond("GET", `/api/admin/${path}`, { data: [] });
  api.define("GET", "/api/admin/audit/requests", () => ({ json: {
    data: Array.from({ length: 6 }, (_, i) => ({ id: `success-log-${i}`, request_id: `success-request-${i}`, model: "fixture-model", status_code: i === 0 ? 200 : 499, error_code: i === 0 ? "" : "request_cancelled", latency_ms: 10, created_at: "2026-09-07T01:00:00Z" })),
    pagination: { page: 1, page_size: 20, total: 6, total_pages: 1 }, summary: { all: 6, ok: 1, error: 0, average_latency_ms: 10 },
  } }), query => {
    expect(query.get("page")).toBe("1");
    expect(["20", "100"]).toContain(query.get("page_size"));
    expect(query.get("status")).toBe("all");
    expect(query.get("q")).toBe("");
    expect(query.size).toBe(4);
  });
  api.respond("GET", "/api/admin/audit/requests/success-request-0", { log: { request_id: "success-request-0", model: "fixture-model", status_code: 200 }, usage: [], attempts: [] });
  await page.goto("/overview/");
  await expect(page.getByRole("article").filter({ hasText: "成功率" })).toContainText("16.67%");
  await expect(page.getByRole("article").filter({ hasText: "成功率" })).toContainText("1 / 6");
  await capture(page, info, page.locator("main"), "success-rate-overview", "团队总览：1 / 6 次成功", "viewport");
  await page.goto("/audit/");
  await expect(page.locator(".request-metrics .metric").filter({ hasText: "成功率" })).toContainText("17%");
  await capture(page, info, page.locator("main"), "success-rate-audit", "请求日志：成功率 17%", "viewport");
});
