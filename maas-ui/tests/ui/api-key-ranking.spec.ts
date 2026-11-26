import { capture, expect, test } from "./harness";
import { user, shellResponses, project } from "./fixtures/shell";

for (const role of ["user", "consumer", "team_leader"] as const) {
 test.describe(`api-key-ranking ${role}`, () => {
 test.use({ sessionUser: { ...user, role } });
 test("shows the signed-in account without a user directory", async ({ page, api }, info) => {
  const summary = { request_count: 1, success_count: 1, errors: 0, input_tokens: 10, output_tokens: 5, total_tokens: 15, estimated_cost_usd: 0.1 };
  const initial = shellResponses().get("GET /api/admin/overview") as Record<string, unknown>;
  api.replaceResponse("GET", "/api/admin/overview", { ...initial, summary });
  api.replaceResponse("GET", "/api/admin/usage/breakdown", { projects: [], models: [], members: [], providers: [], provider_resources: [], cost_centers: [], api_keys: [{ id: "ranking-key", ...summary }] });
  api.respond("GET", "/api/admin/wallet", { balance_micros: 0, available_micros: 0, prepaid_usage: false });
  api.respond("GET", "/api/admin/users", { data: [] });
  api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [{ id: "ranking-key", project_id: project.id, name: "Application Key", owner_user_id: user.id, key_prefix: "sk-fixture", key_suffix: "1234", status: "active", allowed_models: [] }] } }), query => { expect(query.get("page")).toBe("1"); });
  for (const path of ["resources/teams", "resources/announcements", "usage/timeseries"]) api.respond("GET", `/api/admin/${path}`, { data: [] });
  api.define("GET", "/api/admin/audit/requests", () => ({ json: { data: [] } }), query => { expect(query.get("status")).toBe("all"); });
  await page.goto("/overview/");
  await expect(page.getByText("Application Key (sk-fixture...1234)", { exact: true })).toBeVisible();
  await expect(page.getByText(`${user.name} / ${user.email}`, { exact: true })).toBeVisible();
  await expect(page.getByText(user.id, { exact: true })).toHaveCount(0);
  await capture(page, info, page.locator("main"), `api-key-ranking-${role}`, "API Key 排行：本人账户显示姓名与邮箱", "viewport");
 });
 });
}
