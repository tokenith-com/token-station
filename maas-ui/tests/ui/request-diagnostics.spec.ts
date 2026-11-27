import { capture, expect, test } from "./harness";

for (const scenario of ["agent", "error", "historical", "truncated", "mobile", "english"] as const) {
  test.describe(`request-diagnostics ${scenario}`, () => {
    test.use({ sessionLanguage: scenario === "english" ? "en" : "zh-CN" });
    test("renders saved diagnostics without inventing missing evidence", async ({ page, api }, info) => {
      if (scenario === "mobile") await page.setViewportSize({ width: 390, height: 844 });
      const log = { id: "diagnostic-log", request_id: "diagnostic-request", model: "fixture-agent-model", status_code: scenario === "error" ? 504 : 200, error_code: scenario === "error" ? "provider_stream_idle" : "", latency_ms: 1200, created_at: "2026-09-07T01:00:00Z" };
      api.respond("GET", "/api/admin/api-keys", { data: [] });
      api.respond("GET", "/api/admin/audit/events", { data: [] });
      api.define("GET", "/api/admin/audit/requests", () => ({ json: { data: [log], pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 }, summary: { all: 1, ok: scenario === "error" ? 0 : 1, error: scenario === "error" ? 1 : 0, average_latency_ms: 1200 } } }), query => { expect(query.get("page")).toBe("1"); expect(query.get("status")).toBe("all"); });
      const request = { model: log.model, stream: true, max_tokens: 0, messages: [{ role: "user", content: "Synthetic diagnostic prompt" }], tools: [{ type: "function", function: { name: "fixture_tool", parameters: { type: "object" } } }], agent_extension: { enabled: false, value: null } };
      const response = scenario === "historical" ? { stream: true, captured: false } : { stream: true, captured: true, capture_kind: "bounded_sse_events", terminal_observed: scenario !== "error", truncated: false, events: [{ event: "message", data: { choices: [{ delta: { content: "Synthetic diagnostic response" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } }, ...(scenario === "error" ? [] : [{ event: "message", data: "[DONE]" }])] };
      api.respond("GET", "/api/admin/audit/requests/diagnostic-request", { log, usage: [], attempts: [], error_detail: scenario === "error" ? { message: "Synthetic upstream timeout", stage: "upstream_read" } : null, payload: { id: "diagnostic-body", request_id: log.request_id, request_body: JSON.stringify(request), response_body: scenario === "truncated" ? '{"partial": "... truncated' : JSON.stringify(response), request_truncated: false, response_truncated: scenario === "truncated", created_at: log.created_at } });
      await page.goto("/audit/");
      const viewer = page.locator(".request-diagnostics");
      await expect(viewer).toBeVisible();
      const english = scenario === "english";
      const rawUsageLabel = english ? "View raw usage" : "查看原始 usage";
      await expect(viewer.getByText(rawUsageLabel, { exact: true })).toHaveCount(0);
      await viewer.getByText(english ? "Expand payload content" : "展开报文内容", { exact: true }).click();
      await viewer.getByRole("searchbox").fill("fixture_tool");
      await expect(viewer.getByText('"fixture_tool"', { exact: true })).toBeVisible();
      await viewer.getByRole("tab", { name: english ? "Response content" : "响应内容", exact: true }).click();
      await viewer.getByText(english ? "Expand payload content" : "展开报文内容", { exact: true }).click();
      await expect(viewer.getByText(rawUsageLabel, { exact: true })).toBeVisible();
      await expect(viewer.locator(".diagnostic-usage")).not.toHaveAttribute("open");
      if (scenario === "historical") await expect(viewer).toContainText("此历史流仅保存状态摘要");
      else if (scenario === "truncated") await expect(viewer).toContainText("内容已截断");
      else {
        await viewer.getByRole("button", { name: english ? "Raw content" : "原始内容", exact: true }).click();
        await expect(viewer.getByRole("tabpanel")).toContainText("Synthetic diagnostic response");
      }
      const usageDetails = page.locator(".response-usage-details");
      await expect(usageDetails).toBeVisible();
      if (scenario !== "historical" && scenario !== "truncated") {
        await expect(usageDetails.getByText("prompt_tokens", { exact: true })).toBeVisible();
        await expect(usageDetails.getByText("completion_tokens", { exact: true })).toBeVisible();
        await expect(usageDetails.getByText("input_audio_tokens", { exact: true })).toHaveCount(0);
      }
      if (scenario === "error") await expect(page.locator(".request-error-box")).toContainText("upstream_read");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await viewer.scrollIntoViewIfNeeded();
      await capture(page, info, page.locator(".request-detail-panel"), `diagnostics-${scenario}`, `请求诊断：${scenario}`, "viewport");
    });
  });
}
