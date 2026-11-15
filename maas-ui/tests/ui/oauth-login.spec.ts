import type { BrowserContext, Page } from "@playwright/test";
import { oauthBaseURLStorageKey, sessionStorageKey, type AdminUser } from "../../features/admin/core/types";
import configuration from "./config.cjs";
import { test, expect, capture } from "./harness";
import type { MockAPI } from "./network";

const verifier = "ui-oauth-verifier-".padEnd(43, "x");
const callbackCode = "ui-oauth-exchange-code";
const exchangePath = "/api/admin/auth/oauth/exchange";
const oauthUser: AdminUser = {
  id: "usr_ui_oidc", username: "ui-oidc-user", name: "UI OIDC User",
  email: "ui-oidc-user@example.test", role: "user", status: "active",
};

test.use({ sessionUser: null });
test.skip(process.env.NEXT_PUBLIC_TOKENHUB_PORTAL === "c", "OAuth fixtures target the B portal session and overview.");

test.beforeEach(async ({ api }) => {
  api.respond("GET", "/api/admin/auth/identity-providers", { data: [{
    id: "idp_ui_keycloak", name: "UI Keycloak", display_name: "UI Keycloak",
    provider_type: "oidc", icon_key: "keycloak",
  }] });
});

test("login-home keeps the form, model scrolling, theme and mobile layout", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByText("设计预览", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "切回原版" })).toHaveCount(0);
  await expect(page.locator(".tc-login-preview")).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "使用 UI Keycloak 登录" })).toBeVisible();
  const expectHeaderAlignment = async () => {
    const language = page.locator(".tc-login-preview-language button");
    const theme = page.locator(".tc-login-preview-theme");
    const themeBounds = await theme.boundingBox();
    expect(themeBounds).not.toBeNull();
    const centerY = themeBounds!.y + themeBounds!.height / 2;
    await expect(language).toHaveCSS("height", "36px");
    for (const icon of [language.locator("svg").first(), language.locator("svg").last(), theme.locator("svg")]) {
      const bounds = await icon.boundingBox();
      expect(bounds).not.toBeNull();
      expect(Math.abs(bounds!.y + bounds!.height / 2 - centerY)).toBeLessThanOrEqual(1);
    }
  };
  await expectHeaderAlignment();
  const footer = page.locator(".tc-login-preview-footer");
  await expect(page.locator(".tc-login-preview-panel .login-account-footer")).toHaveCount(0);
  await expect(footer.getByRole("link", { name: "世纪利通官网" })).toHaveAttribute("href", "https://www.century-lt.com/cn/");
  await expect(footer.getByText("沪ICP备2023030709号", { exact: true })).toHaveCount(1);
  const footerBounds = await footer.boundingBox();
  const contentBounds = await page.locator(".tc-login-preview-content").boundingBox();
  expect(footerBounds!.y).toBeGreaterThanOrEqual(contentBounds!.y + contentBounds!.height);
  await footer.scrollIntoViewIfNeeded();
  await capture(page, info, footer, "login-page-footer", "Login page legal footer");
  const brandWall = page.locator(".tc-login-preview-brands");
  await expect(brandWall.getByRole("heading", { name: "一个入口，连接主流 AI 模型" })).toBeVisible();
  await expect(brandWall.getByRole("listitem")).toHaveCount(14);
  const tracks = brandWall.locator(".tc-login-preview-brand-track");
  await expect(tracks.first()).toHaveCSS("animation-name", "none");
  const firstModel = brandWall.getByRole("listitem").first();
  await expect(firstModel.locator("strong")).toHaveText("GPT");
  await expect(firstModel.locator("span")).toHaveText("OpenAI");
  const modelBounds = await firstModel.locator("strong").boundingBox();
  const brandBounds = await firstModel.locator("span").boundingBox();
  expect(modelBounds!.y + modelBounds!.height).toBeLessThan(brandBounds!.y);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(tracks.first()).toHaveCSS("animation-name", "tc-preview-brand-scroll");
  await expect(tracks.nth(1)).toHaveCSS("animation-direction", "reverse");
  await brandWall.getByRole("button", { name: "暂停滚动" }).click();
  await expect(tracks.first()).toHaveCSS("animation-play-state", "paused");
  await brandWall.getByRole("button", { name: "继续滚动" }).click();
  await page.mouse.move(0, 0);
  await expect(tracks.first()).toHaveCSS("animation-play-state", "running");
  await brandWall.locator(".tc-login-preview-brand-lane").first().focus();
  await expect(tracks.first()).toHaveCSS("animation-play-state", "paused");
  await page.getByRole("heading", { name: "一个入口，连接主流 AI 模型" }).click();
  await brandWall.scrollIntoViewIfNeeded();
  await capture(page, info, brandWall, "login-model-brand-wall", "模型品牌墙：双行滚动");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const rows = page.locator(".tc-login-preview-insight");
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "洞察模型使用分布" })).toBeVisible();
  await expect(page.locator(".tc-login-preview-health > span")).toHaveCount(100);
  await expect(page.locator(".tc-login-preview-health > .success")).toHaveCount(96);
  await expect(page.locator(".tc-login-preview-health > .warning")).toHaveCount(3);
  await expect(page.locator(".tc-login-preview-health > .failure")).toHaveCount(1);
  for (let index = 0; index < 4; index++) {
    await expect(rows.nth(index).locator(".tc-login-preview-insight-copy p")).not.toBeEmpty();
    const bounds = await rows.nth(index).boundingBox();
    const nextBounds = index < 3 ? await rows.nth(index + 1).boundingBox() : null;
    if (nextBounds) expect(nextBounds.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
    await rows.nth(index).scrollIntoViewIfNeeded();
    await capture(page, info, rows.nth(index), `login-design-insight-${index + 1}`, `登录页图文展示 ${index + 1}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, info, page.locator(".tc-login-preview"), "login-design-preview-desktop", "正式登录页：桌面布局", "viewport");
  await page.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(page.locator(".tc-login-preview")).toHaveAttribute("data-theme", "dark");
  await expectHeaderAlignment();
  await capture(page, info, page.locator(".tc-login-preview"), "login-design-preview-dark", "正式登录页：深色模式", "viewport");
  await page.getByRole("button", { name: "切换到浅色模式" }).click();
  await page.locator(".tc-login-preview-language button").click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Every model. One gateway." })).toBeVisible();
  await expect(page.locator(".tc-login-preview")).toHaveAttribute("lang", "en");
  await expectHeaderAlignment();
  await page.locator(".tc-login-preview-language button").click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectHeaderAlignment();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, info, page.locator(".tc-login-preview"), "login-design-preview-mobile", "正式登录页：移动端登录", "viewport");
  await page.goto("/?loginDesign=preview&auth=login");
  await expect(page.locator(".tc-login-preview")).toBeVisible();
  await expect(page.locator(".tc-home-drawer")).toHaveCount(0);
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
});

async function seedPendingLogin(context: BrowserContext) {
  await context.addInitScript(({ key, pending }) => {
    window.sessionStorage.setItem(key, JSON.stringify(pending));
  }, { key: oauthBaseURLStorageKey, pending: { baseURL: configuration.apiOrigin, codeVerifier: verifier } });
}

async function expectCallbackCleared(page: Page) {
  await expect(page).toHaveURL(`${configuration.frontendOrigin}/overview`);
  expect(await page.evaluate(key => sessionStorage.getItem(key), oauthBaseURLStorageKey)).toBeNull();
}

function installOverviewFixtures(api: MockAPI) {
  api.respond("GET", "/api/admin/usage/timeseries", { data: [] });
  api.respond("GET", "/api/admin/plugins", { data: [] });
  api.respond("GET", "/api/admin/plugin-marketplace", { data: { available: true, plugins: [] } });
  api.respond("GET", "/api/admin/plugin-chain", { data: { hooks: [] } });
  api.respond("GET", "/api/admin/plugin-ui-manifest", { data: [] });
  api.respond("GET", "/api/admin/plugin-actions", { data: [] });
  api.respond("GET", "/api/admin/plugin-background-jobs", { data: [], runs: [] });
  api.respond("GET", "/api/admin/resources/announcements", { data: [] });
  api.define("GET", "/api/admin/audit/requests", () => ({
    json: { data: [], pagination: { page: 1, page_size: 100, total: 0, total_pages: 0 } },
  }), query => {
    expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "100", status: "all", q: "" });
  });
}

test("oauth-login provider error remains visible after callback cleanup", async ({ context, page, api }, info) => {
  await seedPendingLogin(context);
  await page.goto("/overview#oauth_error=provider_error");
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect(page.locator(".login-error")).toHaveText("OAuth 登录失败（provider_error），请重试或联系管理员。");
  await expectCallbackCleared(page);
  await expect(page.getByRole("link", { name: "使用 UI Keycloak 登录" })).toBeVisible();
  expect(api.calls.filter(call => call.path === exchangePath)).toHaveLength(0);
  await capture(page, info, page.locator(".tc-login-card"), "oauth-provider-error", "SSO 登录失败：回调清理后仍显示错误");
});

for (const locale of [
  { language: "en" as const, message: "OAuth sign-in failed (provider_error). Try again or contact your administrator." },
  { language: "ja" as const, message: "OAuth ログインに失敗しました（provider_error）。再試行するか、管理者にお問い合わせください。" },
  { language: "ru" as const, message: "Ошибка входа через OAuth (provider_error). Повторите попытку или обратитесь к администратору." },
]) {
  test.describe(`oauth-login provider error in ${locale.language}`, () => {
    test.use({ sessionLanguage: locale.language });
    test("uses the selected language for the persisted failure", async ({ context, page, api }, info) => {
      await seedPendingLogin(context);
      await page.goto("/overview#oauth_error=provider_error");
      await expect(page.locator("html")).toHaveAttribute("lang", locale.language);
      await expect(page.locator(".login-error")).toHaveText(locale.message);
      await expectCallbackCleared(page);
      expect(api.calls.filter(call => call.path === exchangePath)).toHaveLength(0);
      await capture(page, info, page.locator(".tc-login-card"), `oauth-provider-error-${locale.language}`, "SSO 登录失败：多语言提示");
    });
  });
}

test("oauth-login unknown provider error uses a safe fallback without reflecting callback text", async ({ context, page, api }) => {
  await seedPendingLogin(context);
  const callbackError = "Untrusted callback text <img src=x onerror=alert(1)>";
  await page.goto(`/overview#oauth_error=${encodeURIComponent(callbackError)}`);
  await expect(page.locator(".login-error")).toHaveText("OAuth 登录失败（unknown_error），请重试或联系管理员。");
  await expect(page.locator("body")).not.toContainText(callbackError);
  await expectCallbackCleared(page);
  expect(api.calls.filter(call => call.path === exchangePath)).toHaveLength(0);
});

test("oauth-login successful exchange opens the personal console without a provider dialog", async ({ context, page, api }, info) => {
  await seedPendingLogin(context);
  installOverviewFixtures(api);
  api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [] } }), query => { expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "1000", limit: "1000" }); });
  api.define("POST", exchangePath, request => {
    expect(request.body).toEqual({ code: callbackCode, code_verifier: verifier });
    return { json: { token: "ui-oidc-session", user: oauthUser, expires_at: "2099-01-01T00:00:00Z" } };
  });
  await page.goto(`/overview#oauth_code=${callbackCode}`);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("个人可见范围", { exact: true })).toBeVisible();
  await expectCallbackCleared(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".login-card")).toHaveCount(0);
  expect(api.calls.filter(call => call.path === exchangePath)).toHaveLength(1);
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), `${sessionStorageKey}.b`)).toEqual({
    baseURL: configuration.apiOrigin, token: "ui-oidc-session", user: oauthUser, expiresAt: "2099-01-01T00:00:00Z",
  });
  await capture(page, info, page.locator(".app-shell"), "oauth-personal-console", "SSO 登录成功：进入个人控制台", "viewport");
});

test("oauth-login unexpected callback stays visible and does not exchange a code", async ({ page, api }) => {
  await page.goto(`/overview#oauth_code=${callbackCode}`);
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect(page.locator(".login-error")).toHaveText("OAuth 登录失败");
  await expectCallbackCleared(page);
  expect(api.calls.filter(call => call.path === exchangePath)).toHaveLength(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), `${sessionStorageKey}.b`)).toBeNull();
});

test("oauth-login rejected exchange displays its error without opening the console", async ({ context, page, api }) => {
  await seedPendingLogin(context);
  api.define("POST", exchangePath, request => {
    expect(request.body).toEqual({ code: callbackCode, code_verifier: verifier });
    return { status: 400, json: { error: { code: "invalid_oauth_code", message: "Synthetic OAuth exchange expired" } } };
  });
  await page.goto(`/overview#oauth_code=${callbackCode}`);
  await expect(page.locator(".login-error")).toHaveText("Synthetic OAuth exchange expired");
  await expectCallbackCleared(page);
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(api.calls.filter(call => call.path === exchangePath)).toHaveLength(1);
  expect(await page.evaluate(key => sessionStorage.getItem(key), `${sessionStorageKey}.b`)).toBeNull();
});
