import { test, expect, type Locator, type Page } from "@playwright/test";
import configuration from "./config.cjs";
import { shellResponses, user, model, project } from "./fixtures/shell";
import { navGroupsByRole, roleViewAccess } from "../../features/admin/core/navigation";
import { sessionStorageKey, viewRoutes, type AppRole } from "../../features/admin/core/types";

// Browser toolbars and OS chrome reduce the usable height of a 1366 laptop.
const sizes = [{ width: 1366, height: 598 }, { width: 1280, height: 560 }, { width: 1093, height: 500 }, { width: 1024, height: 640 }];
const apiOrigin = process.env.TOKENHUB_LAYOUT_API_ORIGIN ?? configuration.apiOrigin;
const summary = { request_count: 3, input_tokens: 1000, output_tokens: 100, total_tokens: 1100, estimated_cost_usd: 1, errors: 0 };
const breakdown = { projects: [{ id: project.id, ...summary }], models: [{ id: model.name, ...summary }], members: [{ id: user.id, ...summary }], providers: [], provider_resources: [], cost_centers: [], api_keys: [] };
const provider = { id: "layout-provider", name: "Layout Provider", type: "openai", status: "active", priority: 1, healthy: true };
const routeModel = { id: "layout-route", model_name: model.name, provider_id: provider.id, provider_model: model.name, status: "active", priority: 1, weight: 100 };

async function installLayoutFixtures(page: Page, role: AppRole, signedIn = true) {
  const responses = shellResponses();
  responses.set("GET /api/admin/wallet", { balance_micros: 0, available_micros: 0, prepaid_usage: false });
  responses.set("GET /api/admin/recharge/plans", { data: [], channels: [] });
  responses.set("GET /api/admin/wallet/usage", { data: [] });
  responses.set("GET /api/admin/recharge/orders", { data: [] });
  responses.set("GET /api/admin/projects", { data: [{ ...project, owner_user_id: user.id }] });
  responses.set("GET /api/admin/overview", { summary, projects: [{ ...project, owner_user_id: user.id, team_id: "layout-team" }], models: [model], providers: [provider], provider_resources: [], alerts: [] });
  responses.set("GET /api/admin/models", { data: [model] });
  responses.set("GET /api/admin/providers", { data: [provider] });
  responses.set("GET /api/admin/routing-rules", { data: [routeModel] });
  responses.set("GET /api/admin/users", { data: [{ ...user, role, team_id: "layout-team" }] });
  responses.set("GET /api/admin/api-keys", { data: [{ id: "layout-key", project_id: project.id, owner_user_id: user.id, name: "Laptop application key", key_prefix: "sk-layout", key_suffix: "1234", allowed_models: [model.name], status: "active" }] });
  responses.set("GET /api/admin/api-keys/layout-key/usage", {
    key: { id: "layout-key", project_id: project.id, owner_user_id: user.id, name: "Laptop application key", status: "active" },
    summary: { ...summary, error_count: 0, average_latency_ms: 123 },
    quota: {
      effective_limits: {},
      day: { usage: { requests: 3, total_tokens: 1100, cost_usd: 1 } },
      month: { usage: { requests: 3, total_tokens: 1100, cost_usd: 1 } },
    },
    timeseries: [], models: [], errors: [],
  });
  responses.set("GET /api/admin/resources/settings", { data: [{ id: "cfg_gateway", name: "Gateway settings", status: "active", fields: { public_base_url: "http://tokenhub-ui.invalid/v1", default_timeout: "120s", audit_retention: "30d", provider_egress_mode: "direct" } }] });
  responses.set("GET /api/admin/resources/role-configs", { data: [{ id: "layout-role", name: "Team Member", status: "active", description: "Layout review role", fields: { role_key: "user" } }] });
  responses.set("GET /api/admin/resources/teams", { data: [{ id: "layout-team", name: "Layout Team", status: "active", fields: { owner_user_id: user.id } }] });
  responses.set("GET /api/admin/usage/breakdown", breakdown);
  responses.set("GET /api/admin/audit/requests", { data: Array.from({ length: 8 }, (_, i) => ({ id: `layout-log-${i}`, request_id: `request-layout-${i}-123456789012345678901234567890`, project_id: project.id, api_key_id: "layout-key", model: model.name, provider_id: provider.id, status_code: 200, latency_ms: 123, created_at: "2026-11-02T06:00:00Z", ...summary })), pagination: { page: 1, page_size: 20, total: 8, total_pages: 1 }, summary: { all: 8, ok: 8, error: 0, average_latency_ms: 123 } });
  responses.set("GET /api/admin/plugin-marketplace", { data: { available: true, plugins: [] } });
  responses.set("GET /api/admin/plugin-chain", { data: [], stages: [] });
  responses.set("GET /api/admin/system/db-status", { database_type: "sqlite", is_docker: false, connection_ok: true });
  responses.set("GET /api/admin/system/schema-status", { ready: true, schema_version: 1, pending_expand: [], pending_contract: [], backfills: [], instances: [] });
  if (signedIn) {
    await page.context().addInitScript(({ key, origin, currentUser, portal }) => {
      sessionStorage.setItem(`${key}.${portal}`, JSON.stringify({ baseURL: origin, token: "layout-fixture-session", user: currentUser, expiresAt: "2099-01-01T00:00:00Z" }));
    }, { key: sessionStorageKey, origin: apiOrigin, currentUser: { ...user, role, team_id: "layout-team" }, portal: "b" });
  }
  await page.context().route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      // No third-party resources or services are needed for these layout checks.
      if (url.origin !== new URL(test.info().project.use.baseURL!).origin) return route.abort();
      return route.continue();
    }
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    expect(request.method(), "Layout checks must not save or delete data").toBe("GET");
    let json = responses.get(`GET ${url.pathname}`) ?? { data: [] };
    if (url.pathname.startsWith("/api/admin/audit/requests/")) json = { log: { request_id: decodeURIComponent(url.pathname.split("/").pop()!), model: model.name, status_code: 200, ...summary }, usage: [], attempts: [], payload: null };
    if (url.pathname === "/api/admin/usage/report") json = { range: url.searchParams.get("range"), timezone: "UTC", window_start: "2026-11-02T00:00:00Z", window_end: "2026-11-02T08:00:00Z", granularity: "hour", summary, breakdown, timeseries: [{ date: "2026-11-02T06:00:00Z", ...summary }] };
    return route.fulfill({ json, headers });
  });
}

for (const size of [{ width: 1366, height: 598 }, { width: 1920, height: 1080 }]) {
  test(`team resource pages ${size.width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await installLayoutFixtures(page, "team_leader");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/usage/");
    await expect(page.locator(".sidebar .nav-item")).toHaveText(["团队总览", "团队报表", "可用模型", "模型演练场", "Key 管理", "接口文档", "团队成员", "请求日志"]);
    await expectPageFits(page);
    await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("团队报表");
    await page.getByRole("button", { name: "7 天", exact: true }).click();
    await expect(page.getByRole("button", { name: "7 天", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: test.info().outputPath("team-report.png") });

    await page.locator(".sidebar").getByRole("button", { name: "Key 管理", exact: true }).click();
    await expectPageFits(page);
    await expect(page.getByRole("columnheader", { name: "归属项目", exact: true })).toBeAttached();
    await page.screenshot({ path: test.info().outputPath("team-key-list.png") });
    await page.getByRole("button", { name: "使用", exact: true }).click();
    const access = page.getByRole("dialog", { name: "使用 API Key" });
    await expect(access).toBeVisible();
    await access.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("link", { name: "用量", exact: true }).click();
    await expect(page).toHaveURL(/usage_key=layout-key/);
    await page.getByRole("button", { name: "返回 Key 管理", exact: true }).click();
    await expect(page).not.toHaveURL(/usage_key/);
    await expect(page.getByText("Laptop application key", { exact: true })).toBeVisible();

    // Project access is retained even though the team navigation entry is hidden.
    await page.goto("/projects/");
    await expectPageFits(page);
    await page.screenshot({ path: test.info().outputPath("team-project-list.png") });
    await page.getByRole("button", { name: "查看与配置", exact: true }).click();
    const workspace = page.getByRole("dialog", { name: project.name });
    await expect(workspace).toBeVisible();
    await workspace.getByRole("button", { name: "编辑项目", exact: true }).click();
    await expect(workspace.getByLabel("项目名称", { exact: true })).toHaveValue(project.name);
    await workspace.getByRole("button", { name: "取消", exact: true }).click();

    await page.locator(".sidebar").getByRole("button", { name: "接口文档", exact: true }).click();
    await expectPageFits(page);
    await page.screenshot({ path: test.info().outputPath("team-quick-access.png") });
    await page.getByRole("button", { name: "选择此模型并继续" }).click();
    await page.getByRole("tab", { name: "Python", exact: true }).click();
    await expect(page.locator(".quick-access pre")).toContainText(model.name);
    expect(errors).toEqual([]);
  });
}

for (const role of ["admin", "team_leader", "user", "consumer"] as const) {
  test(`compact menu hover ${role}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 598 });
    await installLayoutFixtures(page, role);
    await page.goto("/overview/");
    await expectPageFits(page);
    await page.locator(".console-topbar-menu").click();
    const sidebar = page.locator(".sidebar.collapsed");
    await expect(sidebar).toBeVisible();
    const items = sidebar.locator(".nav-item");
    for (const item of await items.all()) {
      const label = await item.getAttribute("aria-label");
      expect(await item.getAttribute("title")).toBeNull();
      await item.scrollIntoViewIfNeeded();
      await item.hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toHaveText(label!, { timeout: 1500 });
      await expect(tooltip).toBeVisible({ timeout: 1500 });
      const bounds = await tooltip.boundingBox();
      const sidebarBounds = await sidebar.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(sidebarBounds!.x + sidebarBounds!.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(598);
      expect(await tooltip.evaluate(el => el.parentElement === document.body)).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath("compact-menu-hover.png") });
    await page.mouse.move(500, 70);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await items.first().focus();
    await page.keyboard.press("Tab");
    await expect(items.nth(1)).toBeFocused();
    await expect(page.getByRole("tooltip")).toHaveText((await items.nth(1).getAttribute("aria-label"))!, { timeout: 250 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await items.nth(1).click();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    if (role === "admin") {
      await page.mouse.move(500, 70);
      await page.keyboard.press("Tab");
      await expect(items.nth(2)).toBeFocused();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await sidebar.locator(".sidebar-nav-scroll").evaluate(element => { element.scrollTop = element.scrollTop > 0 ? 0 : element.scrollHeight; });
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  });
}

test.describe("touch menu", () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const role of ["admin", "team_leader", "user", "consumer"] as const) {
    test(`compact menu single tap ${role}`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 598 });
      await installLayoutFixtures(page, role);
      await page.goto("/overview/");
      await page.locator(".console-topbar-menu").tap();
      const target = page.locator(".sidebar.collapsed .nav-item").nth(1);
      await target.tap();
      await expect(target).toHaveClass("nav-item active");
      await expect(page).not.toHaveURL(/\/overview\/$/);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    });
  }
});

for (const role of ["admin", "team_leader", "user"] as const) {
  test(`laptop create dialogs ${role}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1093, height: 500 });
    await installLayoutFixtures(page, role);
    const dialogs = role === "admin"
      ? [{ view: "users", label: "新增用户" }, { view: "teams", label: "新增团队分组" }, { view: "models", label: "新建对外模型" }, { view: "providers", label: "添加供应商" }, { view: "projects", label: "新建项目并配置团队" }]
      : role === "team_leader"
        ? [{ view: "users", label: "新增团队成员" }, { view: "teams", label: "新增团队分组" }, { view: "api-keys", label: "发放 Key" }, { view: "projects", label: "新建项目并配置团队" }]
        : [{ view: "api-keys", label: "创建 Key" }];
    for (const { view, label } of dialogs) {
      await test.step(view, async () => {
        await page.goto(`${viewRoutes[view as keyof typeof viewRoutes]}/`);
        await expectPageFits(page);
        if (view === "settings") await page.getByRole("tab", { name: "角色配置", exact: true }).click();
        const create = page.getByRole("button", { name: label, exact: true }).first();
        await expect(create).toBeVisible();
        await create.click();
        const dialog = page.locator(".modal-backdrop > .modal, .modal-backdrop > [role=dialog], .role-management-dialog");
        await expect(dialog).toBeVisible();
        const bounds = await dialog.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: innerWidth, height: innerHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
        });
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width);
        expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
        // Scrolling the form must make its footer reachable on short screens.
        const cancel = dialog.getByRole("button", { name: /^(取消|关闭)$/ }).last();
        await cancel.scrollIntoViewIfNeeded();
        await expect(cancel).toBeInViewport();
        await expectUnobscured(cancel);
        await page.screenshot({ path: test.info().outputPath(`${view}-dialog.png`) });
        await cancel.click();
        await expect(dialog).toHaveCount(0);
      });
    }
  });
}

for (const size of [...sizes, { width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test(`laptop login ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installLayoutFixtures(page, "user", false);
    await page.goto("/");
    await expect(page.locator(".tc-login-preview")).toBeVisible();
    const form = page.locator(".tc-login-form");
    await expect(form.getByLabel("账号", { exact: true })).toBeVisible();
    const submit = form.getByRole("button", { name: "登录", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await expect(async () => {
      await submit.scrollIntoViewIfNeeded();
      await expectUnobscured(submit);
    }).toPass({ timeout: 5_000 });
    await expect(page.locator(".tc-login-logo img")).toHaveJSProperty("complete", true);
    expect(await page.locator(".tc-login-logo img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("login-home.png") });

  });
}

for (const size of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
  test(`desktop playground ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installLayoutFixtures(page, "user");
    await page.goto("/playground/");
    await expect(page.locator(".playground-model-select select")).toHaveValue(model.name);
    await expectPlaygroundFits(page);
  });
}

test("short playground with a load error and expanded composer", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 598 });
  await installLayoutFixtures(page, "admin");
  await page.route("**/api/admin/models**", async route => {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    await route.fulfill({ status: 503, json: { error: "Layout check: model service unavailable" }, headers });
  });
  await page.goto("/playground/");
  await expectPageFits(page);
  await expect(page.locator(".status-stack .error")).toBeVisible();
  await expectUnobscured(page.locator(".status-stack button"));
  await expectPlaygroundFits(page);
  await page.getByRole("button", { name: "查看代码", exact: true }).click();
  await page.getByRole("button", { name: "模型详情", exact: true }).click();
  await page.locator(".playground-composer textarea").evaluate(el => el.style.height = "120px");
  await expectPlaygroundFits(page);
  await page.screenshot({ path: test.info().outputPath("playground-with-error.png") });
});

async function expectPageFits(page: Page) {
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.locator(".content-panel").evaluate(el => ({
    width: el.clientWidth, scrollWidth: el.scrollWidth,
    top: el.getBoundingClientRect().top,
    topbarBottom: document.querySelector(".console-topbar")!.getBoundingClientRect().bottom,
    bottom: el.getBoundingClientRect().bottom, height: innerHeight,
    documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
  }));
  expect.soft(dimensions.scrollWidth, `Page content overflows: ${page.url()}`).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height + 1);
  expect(dimensions.top).toBeGreaterThanOrEqual(dimensions.topbarBottom - 1);
}

async function expectUnobscured(locator: Locator) {
  const result = await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    // Check both edges as well as the center: a partly clipped button is still a bug.
    return [[r.left + 2, r.top + r.height / 2], [r.left + r.width / 2, r.top + 2], [r.right - 2, r.top + r.height / 2], [r.left + r.width / 2, r.bottom - 2]].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit === el || (hit !== null && el.contains(hit));
      });
  });
  expect(result, `${await locator.evaluate(el => el.outerHTML)} must not be clipped or covered`).toBe(true);
}

async function expectPlaygroundFits(page: Page) {
  await expectPageFits(page);
  const dimensions = await page.evaluate(() => {
    const panel = document.querySelector(".content-panel")!;
    const shell = document.querySelector(".playground-shell")!.getBoundingClientRect();
    const composer = document.querySelector(".playground-composer")!.getBoundingClientRect();
    const chat = document.querySelector(".playground-chat")!.getBoundingClientRect();
    const send = document.querySelector(".playground-send-button")!.getBoundingClientRect();
    const status = panel.querySelector(".status-stack")?.getBoundingClientRect();
    return { panelHeight: panel.clientHeight, scrollHeight: panel.scrollHeight, top: shell.top, panelTop: status?.bottom ?? panel.getBoundingClientRect().top, bottom: shell.bottom, viewport: innerHeight, composerTop: composer.top, composerBottom: composer.bottom, chatBottom: chat.bottom, chatHeight: chat.height, sendBottom: send.bottom };
  });
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.panelHeight + 1);
  expect(dimensions.top).toBeCloseTo(dimensions.panelTop, 0);
  expect(dimensions.bottom).toBeCloseTo(dimensions.viewport, 0);
  expect(dimensions.composerBottom).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.sendBottom).toBeLessThanOrEqual(dimensions.composerBottom);
  expect(dimensions.chatBottom).toBeLessThanOrEqual(dimensions.composerTop + 1);
  if (await page.locator(".playground-code-drawer").count()) {
    await expect(page.locator(".playground-empty")).toBeHidden();
  } else {
    expect(dimensions.chatHeight).toBeGreaterThanOrEqual(128);
    await expectUnobscured(page.locator(".playground-empty strong"));
    await expectUnobscured(page.locator(".playground-empty > span"));
  }
  await expectUnobscured(page.locator(".playground-model-select select"));
  await expectUnobscured(page.locator(".playground-send-button"));
  await expectUnobscured(page.locator(".playground-composer textarea"));
  for (const button of await page.locator(".playground-actions button").all()) await expectUnobscured(button);
}

for (const role of ["admin", "team_leader", "user", "consumer"] as const) {
  const views = roleViewAccess[role];
  for (let startIndex = 0; startIndex < views.length; startIndex += 8) {
    const group = views.slice(startIndex, startIndex + 8);
    test(`small screen table scrolling and page actions ${role}: ${group[0]}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1093, height: 500 });
      await installLayoutFixtures(page, role);
      for (const view of group) {
        await test.step(view, async () => {
          await page.goto(`${viewRoutes[view]}/`);
          await expectPageFits(page);
          for (const table of await page.locator(".content-panel table:visible").all()) {
            const canScroll = await table.evaluate(el => {
              const panel = el.closest(".content-panel")!;
              const bounds = el.getBoundingClientRect();
              const available = panel.getBoundingClientRect();
              if (bounds.left >= available.left && bounds.right <= available.right) return true;
              for (let parent = el.parentElement; parent; parent = parent.parentElement) {
                if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return true;
                if (parent === panel) break;
              }
              return false;
            });
            expect(canScroll, `${view}: wide tables must provide horizontal scrolling`).toBe(true);
          }
          const control = page.locator(".content-panel button:visible:enabled").last();
          if (await control.count()) {
            await control.scrollIntoViewIfNeeded();
            await expectUnobscured(control);
          }
        });
      }
    });
  }


  for (const size of sizes) {
    test(`laptop layout ${role} ${size.width}x${size.height}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(size);
      await installLayoutFixtures(page, role);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/overview/");
      // Exercise each role's real navigation with the sidebar expanded.
      for (const group of navGroupsByRole[role]) {
        for (const item of group.items) {
          if (!("view" in item)) continue;
          const link = page.locator(".sidebar").getByRole("button", { name: item.label, exact: true });
          await link.scrollIntoViewIfNeeded();
          await expectUnobscured(link);
          await link.click();
          await expectPageFits(page);
        }
      }
      for (const view of roleViewAccess[role]) {
        await test.step(view, async () => {
          await page.goto(`${viewRoutes[view]}/`);
          await expectPageFits(page);
          if (view === "playground") {
            await expect(page.locator(".playground-model-select select")).toHaveValue(model.name);
            await expectPlaygroundFits(page);
            if (size.width === 1024 || size.width === 1366) await page.screenshot({ path: test.info().outputPath("playground-default.png") });
            await page.getByRole("button", { name: "查看代码", exact: true }).click();
            await expectPlaygroundFits(page);
            await page.getByRole("button", { name: "模型详情", exact: true }).click();
            await expectPlaygroundFits(page);
            if (size.width === 1024 || size.width === 1366) await page.screenshot({ path: test.info().outputPath("playground-expanded.png") });
            await page.locator(".console-topbar-menu").click();
            await expectPlaygroundFits(page);
            await page.locator(".console-topbar-menu").click();
          }
          if (size.width === 1280) await page.screenshot({ path: test.info().outputPath(`${view}.png`) });
        });
      }
      expect(errors, "All role pages must render without runtime errors").toEqual([]);
    });
  }
}
