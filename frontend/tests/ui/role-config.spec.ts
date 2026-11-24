import { test, expect, capture } from "./harness";

test("role configuration rejects the retired administrator key before saving", async ({ page, api }, info) => {
  for (const path of ["providers", "provider-adapters", "plugins", "plugin-ui-manifest", "plugin-actions", "plugin-background-jobs", "resources/settings", "resources/identity-providers"]) {
    api.respond("GET", `/api/admin/${path}`, { data: [] });
  }
  api.respond("GET", "/api/admin/plugin-chain", { data: { hooks: [] } });
  api.respond("GET", "/api/admin/plugin-marketplace", { data: { available: true, plugins: [] } });
  api.respond("GET", "/api/admin/resources/role-configs", { data: [{
    id: "role_admin", name: "Old administrator name", status: "active",
    fields: { role_key: "admin", display_name: "Old administrator label", data_scope: "global", assignable: true },
  }] });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "角色配置" }).click();
  await expect(page.getByRole("row").filter({ has: page.getByText("admin", { exact: true }) })).toContainText("平台超管");
  await page.getByRole("button", { name: "新增可选角色", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /名称/ }).first().fill("Legacy role");
  await dialog.getByRole("textbox", { name: /角色标识/ }).fill(" SYSTEM_ADMIN ");
  await dialog.getByRole("textbox", { name: /显示名称/ }).fill("Legacy role");
  await dialog.getByRole("combobox", { name: /数据范围/ }).selectOption("global");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();

  await expect(dialog.getByRole("alert")).toHaveText("旧角色标识不可用，请使用 admin");
  await expect(dialog.getByRole("textbox", { name: /角色标识/ })).toHaveValue(" SYSTEM_ADMIN ");
  await capture(page, info, dialog, "retired-role-key", "Retired administrator role validation", "viewport");
});
