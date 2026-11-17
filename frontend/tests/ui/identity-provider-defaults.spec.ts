import { test, expect, capture } from "./harness";

for (const clientID of ["tokenstation-admin", "tokenhub-admin"]) {
  test(`identity-provider-defaults preserves saved ${clientID} and clears create examples`, async ({ page, api }, info) => {
    api.respond("GET", "/api/admin/resources/identity-providers", { data: [{
      id: "idp_ui_defaults", name: "UI Identity", status: "active",
      fields: { provider_type: "oidc", issuer_url: "https://identity.example.test", client_id: clientID },
    }] });
    await page.goto("/identity-providers");
    await page.getByRole("button", { name: "新增身份源", exact: true }).click();
    const dialog = page.locator("form.identity-provider-modal");
    await dialog.getByRole("button", { name: /^通用 OIDC/ }).click();
    await dialog.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(dialog.getByLabel("Client ID", { exact: true })).toHaveValue("");
    await capture(page, info, dialog, `identity-provider-create-${clientID}`, "Identity provider: blank create credentials", "viewport");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(dialog.getByLabel("Client ID", { exact: true })).toHaveValue(clientID);
    await dialog.getByLabel("Client ID", { exact: true }).scrollIntoViewIfNeeded();
    await capture(page, info, dialog, `identity-provider-edit-${clientID}`, "Identity provider: saved client ID preserved", "viewport");
  });
}
