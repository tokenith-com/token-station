import type { Page } from "@playwright/test";
import { capture, expect, test } from "./harness";
import type { MockAPI } from "./network";

const rememberedAccountKey = "tokenstation.remembered-account";
const account = "ui-consumer@example.test";
const password = "UiFixturePassword123!";
const loginPath = "/api/admin/auth/login";
const loginError = "账号或密码错误";

test.use({ sessionUser: null });

test.beforeEach(async ({ api }) => {
  api.respond("GET", "/api/admin/auth/identity-providers", { data: [] });
});

async function showLogin(page: Page) {
  await expect(page.locator('.tc-login')).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎回来", exact: true })).toBeVisible();
}

async function openLogin(page: Page) {
  await page.goto("/");
  await expect(page.locator(".tc-login-preview")).toBeVisible();
  await showLogin(page);
}

function rejectLogin(api: MockAPI) {
  api.define("POST", loginPath, request => {
    expect(request.body).toEqual({ identity: account, password });
    return { status: 401, json: { error: { code: "invalid_credentials", message: loginError } } };
  });
}

async function submitLogin(page: Page) {
  await page.getByRole("textbox", { name: "账号", exact: true }).fill(account);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.locator(".tc-login-form").getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".tc-login-card").getByRole("alert")).toHaveText(loginError);
}

async function expectBrand(page: Page) {
  const brand = page.locator(".tc-login-preview-brand");
  await expect(brand.getByText("TokenStation", { exact: true })).toBeVisible();
  const logo = brand.locator("img");
  await expect(logo).toHaveAttribute("src", "/brand/tokencube-logo.svg");
  await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const panel = page.locator(".tc-login-preview-panel");
  await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.locator(".login-account-visual")).toHaveCount(0);
  const footer = page.locator(".tc-login-preview-footer");
  await expect(footer.getByRole("link", { name: "世纪利通官网", exact: true })).toHaveAttribute("href", "https://www.century-lt.com/cn/");
  await expect(footer.getByText("世纪利通 版权所有 2024–2026", { exact: true })).toBeVisible();
  await expect(footer.getByText("沪ICP备2023030709号", { exact: true })).toBeVisible();
  await expect(page.locator(".tc-login .login-account-footer")).toHaveCount(0);
}

test("consumer-login unified branding and password visibility", async ({ page }, info) => {
  await openLogin(page);
  await expectBrand(page);
  await expect(page.getByRole("checkbox", { name: "记住账号" })).not.toBeChecked();
  const secret = page.getByLabel("密码", { exact: true });
  await secret.fill(password);
  await expect(secret).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(secret).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await expect(secret).toHaveAttribute("type", "password");
  await secret.fill("");
  await capture(page, info, page.locator(".tc-login"), "consumer-login-desktop", "统一登录：居中品牌与账号表单", "viewport");
});

test("consumer-login remembers only the account and supports opting out", async ({ page, api }) => {
  rejectLogin(api);
  await openLogin(page);
  await page.getByRole("checkbox", { name: "记住账号" }).check();
  await submitLogin(page);
  expect(await page.evaluate(key => localStorage.getItem(key), rememberedAccountKey)).toBe(account);
  await page.reload();
  await showLogin(page);
  await expect(page.getByRole("textbox", { name: "账号", exact: true })).toHaveValue(account);
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  await page.getByRole("checkbox", { name: "记住账号" }).uncheck();
  expect(await page.evaluate(key => localStorage.getItem(key), rememberedAccountKey)).toBeNull();
  await submitLogin(page);
  expect(await page.evaluate(key => localStorage.getItem(key), rememberedAccountKey)).toBeNull();
  await page.reload();
  await showLogin(page);
  await expect(page.getByRole("textbox", { name: "账号", exact: true })).toHaveValue("");
  expect(api.calls.filter(call => call.path === loginPath)).toHaveLength(2);
});

test("consumer-login registration preserves branding and returns to login", async ({ page, api }, info) => {
  api.respond("GET", "/api/admin/auth/register/captcha", {
    captcha_id: "ui-consumer-captcha", image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", expires_in_secs: 300,
  });
  await openLogin(page);
  await page.getByRole("button", { name: "邮箱注册", exact: true }).click();
  await expect(page.getByRole("heading", { name: "注册账号", exact: true })).toBeVisible();
  await expectBrand(page);
  await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "验证码", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送激活邮件", exact: true })).toBeVisible();
  await capture(page, info, page.locator(".tc-login"), "consumer-login-registration", "邮箱注册：保留品牌并可返回登录", "viewport");
  await page.getByRole("button", { name: "已有账号？返回登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "欢迎回来", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "记住账号" })).not.toBeChecked();
  expect(api.calls.filter(call => call.path === "/api/admin/auth/register/captcha")).toHaveLength(1);
});

test("consumer-login rejected credentials keep the branded login visible", async ({ page, api }, info) => {
  rejectLogin(api);
  await openLogin(page);
  await submitLogin(page);
  await expectBrand(page);
  await expect(page.locator(".tc-login-form").getByRole("button", { name: "登录", exact: true })).toBeEnabled();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect(api.calls.filter(call => call.path === loginPath)).toHaveLength(1);
  await capture(page, info, page.locator(".tc-login"), "consumer-login-error", "统一登录：错误反馈与重试入口", "viewport");
});

test("consumer-login mobile keeps branding and actions within the viewport", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLogin(page);
  await expectBrand(page);
  for (const control of [page.getByRole("textbox", { name: "账号", exact: true }), page.getByLabel("密码", { exact: true }), page.getByRole("checkbox", { name: "记住账号" }), page.getByRole("button", { name: "邮箱注册", exact: true }), page.locator(".tc-login-form").getByRole("button", { name: "登录", exact: true })]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture(page, info, page.locator(".tc-login"), "consumer-login-mobile", "统一登录：移动端品牌与操作", "viewport");
});

test("consumer-login short viewport keeps all actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await openLogin(page);
  const brand = await page.locator(".tc-login-preview-brand").boundingBox();
  expect(brand!.y).toBeGreaterThanOrEqual(0);
  await page.getByRole("button", { name: "邮箱注册", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "邮箱注册", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("consumer-login dark theme retains the shared branding", async ({ context, page }, info) => {
  await context.addInitScript(() => localStorage.setItem("tokenhub.theme", "dark"));
  await openLogin(page);
  await expect(page.locator('.tc-login')).toHaveAttribute("data-theme", "dark");
  await expectBrand(page);
  await capture(page, info, page.locator(".tc-login"), "consumer-login-dark", "统一登录：深色主题品牌", "viewport");
});


test("consumer-login handles email activation inside the shared portal", async ({ page, api }) => {
  api.define("GET", "/api/admin/auth/activation/verify", () => ({ json: { email: account, expires_at: "2099-01-01T00:00:00Z" } }), query => {
    expect(Object.fromEntries(query)).toEqual({ token: "synthetic-activation" });
  });
  api.define("POST", "/api/admin/auth/activation/complete", ({ body }) => {
    expect(body).toEqual({ token: "synthetic-activation", password, confirm_password: password });
    return { json: { user: { email: account } } };
  });
  await page.goto("/#activation_token=synthetic-activation");
  await expect(page.locator(".tc-login-preview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "激活账号", exact: true })).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(account);
  await page.getByLabel("设置密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "激活账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "欢迎回来", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "账号", exact: true })).toHaveValue(account);
  expect(new URL(page.url()).hash).toBe("");
});
