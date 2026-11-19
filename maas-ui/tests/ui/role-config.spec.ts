import { test, expect, capture } from "./harness";

test("role management shows the canonical platform administrator name", async ({ page, api }, info) => {
  api.respond("GET", "/api/admin/resources/role-configs", { data: [{
    id: "role_admin", name: "Old administrator name", status: "active",
    fields: { role_key: "admin", display_name: "Old administrator label", data_scope: "global", assignable: true },
  }] });
  await page.goto("/role-configs/");
  const row = page.getByRole("row").filter({ hasText: "平台超管" });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Old administrator label");
  await capture(page, info, row, "canonical-admin-role", "Platform administrator role");
});
