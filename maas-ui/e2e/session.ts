import { expect, type Page } from "@playwright/test";
import defaults from "./config.cjs";

export async function openLogin(page: Page) {
  await page.getByRole("button", { name: "登录", exact: true }).click();
  return page.locator(".tc-login-form");
}

export async function signInAdmin(page: Page) {
  const form = await openLogin(page);
  await form.getByLabel("账号", { exact: true }).fill(defaults.adminIdentity);
  await form.getByLabel("密码", { exact: true }).fill(process.env.TOKENHUB_E2E_ADMIN_PASSWORD ?? defaults.adminPassword);
  await form.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

export async function login(page: Page) {
  await page.goto("/");
  await signInAdmin(page);
}
