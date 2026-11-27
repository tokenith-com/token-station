import { capture, expect, test } from "./harness";
import { user } from "./fixtures/shell";

for (const role of ["admin", "team_leader"] as const) {
  test.describe(`request-payload-privacy ${role}`, () => {
    test.use({ sessionUser: { ...user, role } });
    test("shows stored bodies only to platform administrators", async ({ page, api }, info) => {
      api.respond("GET", "/api/admin/wallet", { balance_micros: 0, available_micros: 0, prepaid_usage: false });
      api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [] } }), query => {
        expect(Object.fromEntries(query)).toEqual(role === "admin" ? {} : { page: "1", page_size: "1000", limit: "1000" });
      });
      const log = { id: "privacy-log", request_id: "privacy-request", model: "fixture-model", status_code: 200, latency_ms: 12, created_at: "2026-09-07T01:00:00Z" };
      api.define("GET", "/api/admin/audit/requests", () => ({ json: { data: [log], pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 }, summary: { all: 1, ok: 1, error: 0, average_latency_ms: 12 } } }), query => {
        expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "20", status: "all", q: "" });
      });
      // Deliberately supply bodies to both roles to test the UI's defense in depth.
      api.respond("GET", "/api/admin/audit/requests/privacy-request", { log, usage: [], attempts: [], payload: { id: "privacy-body", request_id: log.request_id, request_body: "Synthetic private request", response_body: "Synthetic private response", request_truncated: false, response_truncated: false, created_at: log.created_at } });
      if (role === "admin") api.respond("GET", "/api/admin/audit/events", { data: [] });
      await page.goto("/audit/");
      await expect(page.locator(".request-id-line")).toContainText(log.request_id);
      if (role === "admin") {
        await page.getByText("展开报文内容", { exact: true }).click();
        await expect(page.getByText("Synthetic private request", { exact: true })).toBeVisible();
        await page.getByRole("tab", { name: "响应内容", exact: true }).click();
        await page.getByText("展开报文内容", { exact: true }).click();
        await expect(page.getByText("Synthetic private response", { exact: true })).toBeVisible();
      } else {
        await expect(page.getByText("请求与响应", { exact: true })).toHaveCount(0);
        await expect(page.getByText("展开报文内容", { exact: true })).toHaveCount(0);
        await expect(page.getByText("Synthetic private request", { exact: true })).toHaveCount(0);
      }
      await capture(page, info, page.locator(".request-detail-panel"), `request-payload-${role}`, `请求正文权限：${role}`, "viewport");
    });
  });
}
