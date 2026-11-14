import { test, expect, capture } from "./harness";
import type { Page } from "@playwright/test";
import { user } from "./fixtures/shell";

test.beforeEach(async ({ context, api }) => {
  api.respond("GET", "/icon.svg", {});
  api.respond("POST", "/api/admin/auth/login", { token: "ui-fixture-token", user, expires_at: "2099-01-01T00:00:00Z" });
  await context.route("**/icon.svg", route => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" />' }));
});

async function enterConsole(page: Page, path: string) {
  await page.route("**/icons/sprite.svg", route => route.continue());
  await page.route("**/*", route => route.request().method() === "HEAD" && ["/users/", "/api-keys/"].includes(new URL(route.request().url()).pathname) ? route.fulfill({ status: 200, body: "" }) : route.fallback());
  await page.goto(path);
  await expect(page.locator(".app-shell")).toBeVisible();
}

test("platform-account-onboarding opens from the actual administrator shell", async ({ page, api }, testInfo) => {
  api.respond("GET", "/api/admin/users", { data: [user] });
  api.respond("GET", "/api/admin/resources/teams", { data: [] });
  api.respond("GET", "/api/admin/resources/role-configs", { data: [] });
  await enterConsole(page, "/users");
  const entry = page.getByRole("button", { name: "开通客户", exact: true });
  await expect(entry).toBeVisible();
  await entry.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/成本中心编码/)).toBeVisible();
  await expect(dialog.getByLabel(/成本中心名称/)).toBeVisible();
  expect(api.calls.some(call => call.method === "POST" && call.path === "/api/admin/customer-onboarding")).toBe(false);
  await capture(page, testInfo, dialog, "platform-account-onboarding", "平台账号开通客户入口与第一步");
});

test("administrator-key-list resolves secrets only when requested", async ({ page, api }, testInfo) => {
  api.respond("GET", "/api/admin/users", { data: [user] });
  api.respond("GET", "/api/admin/resources/teams", { data: [] });
  api.respond("GET", "/api/admin/resources/project-members", { data: [] });
  api.respond("GET", "/api/admin/api-keys", { data: [{ id: "key_ui_actions", project_id: "prj_ui", name: "Synthetic UI Key", status: "active", key_prefix: "sk_ui", key_suffix: "test", allowed_models: [], limits: {} }] });
  const secretPath = "/api/admin/api-keys/key_ui_actions/secret";
  api.respond("GET", secretPath, { api_key: "sk_synthetic_ui_secret_only" });
  await enterConsole(page, "/api-keys");
  const reveal = page.getByRole("button", { name: "显示 Key", exact: true });
  await expect(reveal).toBeVisible();
  await expect(page.getByRole("button", { name: "复制 Key", exact: true })).toBeVisible();
  expect(api.calls.filter(call => call.path === secretPath)).toHaveLength(0);
  await reveal.click();
  await expect(page.getByText("sk_synthetic_ui_secret_only", { exact: true })).toBeVisible();
  expect(api.calls.filter(call => call.path === secretPath)).toHaveLength(1);
  await page.getByRole("button", { name: "隐藏 Key", exact: true }).click();
  await expect(page.getByText("sk_synthetic_ui_secret_only", { exact: true })).not.toBeVisible();
  await capture(page, testInfo, page.locator(".app-shell"), "administrator-key-actions", "Key 列表查看与复制按钮", "viewport");
});
