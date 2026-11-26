import { test, expect } from "@playwright/test";
import { maasSessionStorageKey } from "../../features/admin/core/types";

test("same-origin-key-access: newly issued key includes complete protocol URLs", async ({ page }) => {
  test.skip(process.env.TOKENHUB_UI_SAME_ORIGIN !== "1", "Requires --same-origin build.");
  const user = { id: "usr_fixture", name: "Fixture Member", role: "user", status: "active" };
  const key = { id: "key_fixture", name: "Synthetic Key", project_id: "prj_fixture", owner_user_id: user.id, key_prefix: "sk-fixture", key_suffix: "1234", allowed_models: [], status: "active" };
  let created = false;
  await page.addInitScript(({ storageKey, user }) => sessionStorage.setItem(storageKey, JSON.stringify({ baseURL: "/", token: "synthetic-session", user, expiresAt: "2099-01-01T00:00:00Z" })), { storageKey: maasSessionStorageKey, user });
  await page.route("**/*", async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/admin/wallet") return route.fulfill({ json: { balance_micros: 0, available_micros: 0, prepaid_usage: false } });
    if (path === "/api/admin/api-keys") {
      if (req.method() === "POST") { created = true; return route.fulfill({ status: 201, json: { ...key, api_key: "sk_synthetic_only_1234" } }); }
      return route.fulfill({ json: { data: created ? [key] : [] } });
    }
    if (path === "/api/admin/overview") return route.fulfill({ json: { summary: { request_count: 0, total_tokens: 0, errors: 0 }, projects: [], models: [], providers: [], alerts: [] } });
    if (["/api/admin/resources/project-members", "/api/admin/system/version"].includes(path)) return route.fulfill({ json: { data: [] } });
    throw Error(`Unexpected API request: ${req.method()} ${path}`);
  });
  await page.goto("/api-keys/");
  await page.getByRole("button", { name: "新建 API Key", exact: true }).click();
  await page.getByRole("textbox", { name: /名称：/ }).fill(key.name);
  await page.getByRole("button", { name: "确定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "使用 API Key" });
  const origin = new URL(page.url()).origin;
  await expect(dialog.getByLabel("接入地址（Base URL）", { exact: true })).toHaveValue(`${origin}/v1`);
  await expect(dialog.getByLabel("请求地址", { exact: true })).toHaveValue(`${origin}/v1/chat/completions`);
  await expect(dialog.getByLabel("cURL", { exact: true })).toHaveValue(new RegExp(origin));
  await dialog.getByLabel("接入协议").selectOption("anthropic");
  await expect(dialog.getByLabel("接入地址（Base URL）", { exact: true })).toHaveValue(origin);
  await dialog.getByLabel("接入协议").selectOption("gemini");
  await expect(dialog.getByLabel("请求地址", { exact: true })).toHaveValue(`${origin}/v1beta/models/YOUR_MODEL:generateContent`);
});
