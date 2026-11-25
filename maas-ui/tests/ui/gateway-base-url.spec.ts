import { capture, expect, test } from "./harness";
import configuration from "./config.cjs";
import { model, project, user } from "./fixtures/shell";

test.use({ sessionUser: { ...user, role: "team_leader", team_id: "team_gateway_fixture" } });

test("gateway-base-url: tool examples retain the complete API origin", async ({ page, api }, info) => {
  api.respond("GET", "/api/admin/resources/project-members", { data: [] });
  api.respond("GET", "/api/admin/teams/team_gateway_fixture/wallet", { wallet: { team_id: "team_gateway_fixture", balance_micros: 0 }, currency: "CNY", paid_calls_enabled: false });
  api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [{ id: "key_gateway_fixture", name: "Gateway fixture key", project_id: project.id, owner_user_id: user.id, key_prefix: "sk-fixture", key_suffix: "1234", allowed_models: [model.name], status: "active" }] } }), query => {
    expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "1000", limit: "1000" });
  });
  api.define("GET", "/api/admin/audit/requests", () => ({ json: { data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 }, summary: { all: 0, ok: 0, error: 0, average_latency_ms: 0 } } }), query => {
    expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "20", status: "all", q: "" });
  });
  await page.goto("/gateway/");
  await page.getByRole("button", { name: "选择此模型并继续" }).click();
  await page.getByRole("tab", { name: "AI 工具接入", exact: true }).click();
  const code = page.locator(".quick-access pre");
  await expect(code).toContainText(`export OPENAI_BASE_URL="${configuration.apiOrigin}/v1"`);
  await expect(code).toContainText(`export OPENAI_MODEL="${model.name}"`);
  await expect(code).not.toContainText('OPENAI_BASE_URL="/v1"');
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await expect(code).toContainText(`"OPENAI_BASE_URL": "${configuration.apiOrigin}/v1"`);
  await capture(page, info, page.locator(".quick-access"), "gateway-base-url", "接口文档：工具接入地址包含完整域名", "viewport");
});
