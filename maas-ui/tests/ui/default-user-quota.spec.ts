import type { AdminResource, AdminUser } from "../../features/admin/core/types";
import { test, expect, capture } from "./harness";
import { user } from "./fixtures/shell";

for (const scenario of ["save", "failed-save"] as const) {
  test(`quota default-user-${scenario}`, async ({ page, api }, testInfo) => {
    let policies: AdminResource[] = [];
    api.respond("GET", "/api/admin/api-keys", { data: [] });
    api.respond("GET", "/api/admin/users", { data: [user] });
    api.respond("GET", "/api/admin/resources/teams", { data: [] });
    api.define("GET", "/api/admin/resources/quota-policies", () => ({ json: { data: policies } }));
    api.define("POST", "/api/admin/resources/quota-policies", (input) => {
      expect(input.body).toMatchObject({ name: "Default monthly allowance", status: "active", fields: { scope: "user", scope_id: "all_users", monthly_cost_usd: 50 } });
      if (scenario === "failed-save") return { status: 400, json: { error: { message: "Policy could not be saved" } } };
      const policy = { ...(input.body as AdminResource), id: "quota_default" };
      policies = [policy];
      return { json: policy };
    });
    api.define("PATCH", "/api/admin/resources/quota-policies/quota_default", (input) => {
      expect(input.body).toMatchObject({ fields: { scope: "user", scope_id: "all_users", monthly_cost_usd: 25 } });
      policies = [{ ...(input.body as AdminResource), id: "quota_default" }];
      return { json: policies[0] };
    });
    await page.goto("/quota-policies");
    await page.getByRole("button", { name: "新增额度策略", exact: true }).first().click();
    await page.getByRole("textbox", { name: "名称", exact: true }).fill("Default monthly allowance");
    await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("active");
    await page.getByRole("combobox", { name: "作用域", exact: true }).selectOption("user");
    const target = page.getByRole("combobox", { name: /^作用域对象/ });
    await target.selectOption("all_users");
    await page.getByRole("spinbutton", { name: "月成本 USD", exact: true }).fill("50");
    await capture(page, testInfo, target.locator(".."), `default-user-${scenario}-target`, "默认用户额度：独立额度与严格合并说明");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    if (scenario === "failed-save") {
      await expect(page.getByRole("alert").getByText("Policy could not be saved", { exact: true })).toBeVisible();
      await expect(target).toHaveValue("all_users");
      await expect(page.getByRole("spinbutton", { name: "月成本 USD", exact: true })).toHaveValue("50");
      return;
    }
    const row = page.getByRole("row").filter({ hasText: "Default monthly allowance" });
    await expect(row).toContainText("按用户分别统计");
    await expect(row).toContainText("所有用户（每人独立额度）");
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(target).toHaveValue("all_users");
    await page.getByRole("spinbutton", { name: "月成本 USD", exact: true }).fill("25");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(target).toHaveCount(0);
    await expect(row).toContainText("按用户分别统计");
    await capture(page, testInfo, row, "default-user-saved-policy", "默认额度保存后保留每人独立统计语义");
  });
}

const teamLeader: AdminUser = {
  ...user,
  id: "usr_ui_team_leader",
  username: "ui-team-leader",
  name: "UI Team Leader",
  email: "ui-team-leader@example.test",
  role: "team_leader",
  team_id: "team_ui",
};
const teamMember: AdminUser = {
  ...user,
  id: "usr_ui_team_member",
  username: "ui-team-member",
  name: "UI Team Member",
  email: "ui-team-member@example.test",
  role: "user",
  team_id: "team_ui",
};

test.describe("quota default-user permissions", () => {
  test.use({ sessionUser: teamLeader });

  test("quota default-user-team-leader-target", async ({ page, api }, testInfo) => {
    api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [] } }), query => {
      expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "1000", limit: "1000" });
    });
    api.respond("GET", "/api/admin/users", { data: [teamLeader, teamMember] });
    api.respond("GET", "/api/admin/resources/teams", { data: [{ id: "team_ui", name: "UI Review Team", status: "active" }] });
    api.respond("GET", "/api/admin/resources/quota-policies", { data: [] });

    api.define("GET", "/api/admin/audit/requests", () => ({ json: { data: [] } }), query => {
      expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "100", status: "all", q: "" });
    });
    api.respond("GET", "/api/admin/usage/timeseries", { data: [] });
    api.respond("GET", "/api/admin/resources/announcements", { data: [] });
    await page.goto("/quota-policies");
    await expect(page).toHaveURL(/\/overview\/$/);
    await expect(page.getByRole("button", { name: "新增额度策略", exact: true })).toHaveCount(0);
    expect(api.calls.filter(call => call.path === "/api/admin/resources/quota-policies")).toHaveLength(0);
    await capture(page, testInfo, page.locator(".app-shell"), "default-user-team-leader-target", "团队负责人无法进入全局额度策略", "viewport");
  });
});
