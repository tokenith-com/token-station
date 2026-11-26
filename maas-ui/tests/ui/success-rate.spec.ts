import { capture, expect, test } from "./harness";
import { shellResponses, user } from "./fixtures/shell";

test.use({ sessionUser: { ...user, role: "team_leader" } });
for (const total of [6, 243]) {
const percentage = total === 6 ? "16.67%" : "0.41%";
test(`success-rate: one success out of ${total} requests`, async ({ page, api }, info) => {
  const overview = shellResponses().get("GET /api/admin/overview") as { summary: Record<string, number> };
  api.replaceResponse("GET", "/api/admin/overview", { ...overview, summary: { ...overview.summary, request_count: total, success_count: 1, errors: 0 } });
  api.respond("GET", "/api/admin/wallet", { balance_micros: 0, available_micros: 0, prepaid_usage: false });
  api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [] } }), query => {
    expect(["", "page=1&page_size=1000&limit=1000"]).toContain(query.toString());
  });
  api.respond("GET", "/api/admin/users", { data: [user] });
  for (const path of ["resources/teams", "resources/announcements", "usage/timeseries"]) api.respond("GET", `/api/admin/${path}`, { data: [] });
  api.define("GET", "/api/admin/audit/requests", () => ({ json: {
    data: Array.from({ length: 6 }, (_, i) => ({ id: `success-log-${i}`, request_id: `success-request-${i}`, model: "fixture-model", status_code: i === 0 ? 200 : 499, error_code: i === 0 ? "" : "request_cancelled", latency_ms: 10, created_at: "2026-09-07T01:00:00Z" })),
    pagination: { page: 1, page_size: 20, total, total_pages: Math.ceil(total / 20) }, summary: { all: total, ok: 1, error: 0, average_latency_ms: 10 },
  } }), query => {
    expect(query.get("page")).toBe("1");
    expect(["20", "100"]).toContain(query.get("page_size"));
    expect(query.get("status")).toBe("all");
    expect(query.get("q")).toBe("");
    expect(query.size).toBe(4);
  });
  api.respond("GET", "/api/admin/audit/requests/success-request-0", { log: { request_id: "success-request-0", model: "fixture-model", status_code: 200 }, usage: [], attempts: [] });
  await page.goto("/overview/");
  await expect(page.getByRole("article").filter({ hasText: "成功率" })).toContainText(percentage);
  await expect(page.getByRole("article").filter({ hasText: "成功率" })).toContainText(`1 / ${total}`);
  await capture(page, info, page.locator("main"), `success-rate-overview-${total}`, `团队总览：1 / ${total} 次成功`, "viewport");
  await page.goto("/audit/");
  await expect(page.locator(".request-metrics .metric").filter({ hasText: "成功率" })).toContainText(percentage);
  await capture(page, info, page.locator("main"), `success-rate-audit-${total}`, `请求日志：成功率 ${percentage}`, "viewport");
});

}
