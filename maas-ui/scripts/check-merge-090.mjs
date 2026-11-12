import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

// Browser-only fixtures: never writes test records to the configured backend.
const origin = process.env.TOKENHUB_SMOKE_ORIGIN || "http://127.0.0.1:3100";
const consumerOrigin = process.env.TOKENHUB_SMOKE_C_ORIGIN;
const screenshotDirectory = process.env.TOKENHUB_SMOKE_SCREENSHOT_DIR;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const menus = {
  admin: ["overview", "providers", "models", "routes", "playground", "users", "settings"],
  team_leader: ["overview", "models", "users", "teams", "audit", "gateway"],
  user: ["overview", "gateway", "models", "playground", "api-keys", "usage", "audit"],
  guest: ["overview", "gateway", "models", "playground", "api-keys", "usage", "audit", "billing", "balance-recharge", "invoices"],
};
const models = [{ id: "merge_model", name: "merge-smoke-model", family: "custom", modality: "chat", status: "active", metadata: { tokenhub_published: "true" } }];
const catalogModels = [...models, { id: "merge_template", name: "merge-reference-model", family: "claude", modality: "chat", status: "active", metadata: { source: "tokenhub-standard-catalog" } }];
const projects = [{ id: "merge_project", name: "Merge project", status: "active" }];
const providers = [{ id: "merge_provider", name: "Merge test provider with a long channel name", type: "openai_compatible", status: "active", healthy: true, priority: 100, base_url: "https://chatgpt.com/backend-api/codex/long-provider-endpoint" }];
// A configured healthy Provider can still be unobserved; the backend snapshot is authoritative.
const providerMonitoring = [{
  provider: providers[0], adapter: { type: "openai_compatible", capabilities: [] },
  route_count: 1, active_route_count: 1, resource_count: 0, active_resource_count: 0, healthy_resource_count: 0,
  state: "unknown", status_label: "Awaiting Test", status_detail: "awaiting_observation",
  configuration: { state: "healthy", source: "configuration", detail: "provider_online", samples: 0 },
  resources: { state: "unknown", source: "configuration", samples: 0 },
  active_probe: { state: "unknown", source: "active_probe", samples: 0 },
  gateway: { state: "unknown", source: "gateway_request", samples: 0 },
  quota: { supported: false, limit_reached: false, successful_accounts: 0, failed_accounts: 0 },
  quality_score: 37, trend: ["none", "success", "warning", "failure"],
}];
const routes = [{ id: "merge_route", model_name: models[0].name, provider_id: providers[0].id, provider_model: "merge-upstream", priority: 1, weight: 100, quality_score: 80, cost_score: 40, status: "active", strategy: "balanced" }];
const comparisonModel = { ...models[0], id: "merge_comparison", name: "merge-comparison-model", supported_parameters: ["temperature", "top_p"], context_window: 8192 };
const comparisonRoute = { ...routes[0], id: "merge_comparison_route", model_name: comparisonModel.name };
const breakdown = { projects: [], models: [], members: [], providers: [], provider_resources: [], cost_centers: [] };
const summary = { request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0, errors: 0, api_key_count: 0, route_count: 1, active_route_count: 1, user_count: 1 };
const browser = await chromium.launch({ headless: true, ...(process.env.TOKENHUB_BROWSER_CHANNEL ? { channel: process.env.TOKENHUB_BROWSER_CHANNEL } : {}) });
try {
  for (const [role, pages] of Object.entries(menus)) {
    if (role === "guest" && !consumerOrigin) continue;
    const portalOrigin = role === "guest" ? consumerOrigin : origin;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    const chats = [];
    let failedRequest = null;
    const user = { id: `merge_${role}`, username: role, name: role, email: "merge@example.test", role, status: "active" };
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/backend/**", async route => {
      const path = new URL(route.request().url()).pathname.replace("/api/backend", "");
      const method = route.request().method();
      if (failedRequest?.path === path && failedRequest.method === method) {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "Modal request failed" } }) });
        return;
      }
      if (path === "/api/admin/playground/chat/stream") {
        chats.push(route.request().postDataJSON());
        const now = new Date().toISOString();
        const events = [{ type: "started", request_id: "smoke", started_at: now }, { type: "delta", delta: chats.at(-1).model === comparisonModel.name ? "Comparison stream response" : "Merge stream response", received_at: now, mode: "stream" }, { type: "completed", request_id: "smoke", usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }];
        await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
        return;
      }
      let body = { data: [] };
      const inPlayground = new URL(page.url()).pathname === "/playground";
      const availableModels = inPlayground ? [...catalogModels, comparisonModel] : catalogModels;
      if (path === "/api/admin/auth/login") body = { token: "merge-browser-session", user, expires_at: "2099-01-01T00:00:00Z" };
      else if (path === "/api/admin/auth/me") body = { user };
      else if (path === "/api/admin/overview") body = { summary, projects, models: availableModels, providers, provider_resources: [] };
      else if (path === "/api/admin/models") body = { data: availableModels };
      else if (path === "/api/admin/projects") body = { data: projects };
      else if (path === "/api/admin/providers") body = { data: providers };
      else if (path === "/api/admin/providers/monitoring") body = { data: providerMonitoring };
      else if (path === "/api/admin/routing-rules") body = { data: inPlayground ? [...routes, comparisonRoute] : routes };
      else if (path === "/api/admin/provider-models") body = { data: [{ id: "merge_upstream", provider_id: providers[0].id, upstream_model: "merge-upstream", status: "active" }] };
      else if (path === "/api/admin/users") body = { data: [user] };
      else if (path === "/api/admin/usage/breakdown") body = breakdown;
      else if (path === "/api/admin/usage/daily") body = { summary, breakdown, timezone: "UTC", date: "2026-10-09" };
      else if (path.includes("/audit/requests")) body = { data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 }, summary: { all: 0, ok: 0, error: 0, average_latency_ms: 0 } };
      if (method === "PATCH") writes.push({ path, body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(portalOrigin);
    await page.getByLabel("账号", { exact: true }).fill("merge@example.test");
    await page.getByLabel("密码", { exact: true }).fill("fixture-only");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.locator(".sidebar").waitFor();
    for (const view of pages) {
      await page.goto(`${portalOrigin}/${view}`);
      await page.locator(".sidebar").waitFor();
      await page.waitForLoadState("networkidle");
      assert.equal(await page.getByText("This page could not be found.").count(), 0, `${role}/${view}: 404`);
      if (role === "admin" && view === "providers") {
        assert.deepEqual(await page.locator(".provider-channel-table th").allTextContents(), [
          "服务商 / 通道", "健康与基础监控", "模型、路由与账号", "真实监控 · L3", "性能与质量", "账号配额", "操作",
        ]);
        assert.deepEqual(await page.locator(".provider-monitor-summary strong").allTextContents(), ["0", "0", "0", "1"]);
        assert.equal(await page.locator(".provider-quality-score > strong").innerText(), "37");
        await page.locator(".provider-monitor-status.unknown").getByText("Awaiting Test", { exact: true }).waitFor();
        await page.getByText("1 个已引入模型", { exact: true }).waitFor();
        for (const width of [2560, 1920, 1440, 1280]) {
          await page.setViewportSize({ width, height: 1000 });
          const layout = await page.locator(".provider-channel-panel").evaluate(panel => {
            const wrapper = panel.querySelector(".provider-monitor-table-wrap");
            const cell = panel.querySelector("tbody td:last-child");
            const buttons = cell.querySelectorAll("button");
            const cellBounds = cell.getBoundingClientRect();
            return {
              overflow: wrapper.scrollWidth - wrapper.clientWidth,
              wrapperWidth: wrapper.clientWidth,
              buttonsInside: [...buttons].every(button => {
                const bounds = button.getBoundingClientRect();
                return bounds.left >= cellBounds.left && bounds.right <= cellBounds.right;
              }),
              headers: panel.querySelectorAll("thead th").length,
              pageOverflow: globalThis.document.documentElement.scrollWidth - globalThis.window.innerWidth,
            };
          });
          assert.equal(layout.headers, 7, "providers must reuse the native channel monitoring table");
          assert.ok(layout.pageOverflow <= 1, `provider page overflows at ${width}px`);
          if (layout.wrapperWidth >= 1120) {
            assert.ok(layout.overflow <= 1, `provider table overflows at ${width}px: ${layout.overflow}px`);
          }
          assert.ok(layout.buttonsInside, `provider action buttons overflow their cell at ${width}px`);
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.getByRole("button", { name: "配置路由", exact: true }).click();
        await page.waitForURL(`${portalOrigin}/routes`);
        await page.getByRole("button", { name: "添加线路", exact: true }).waitFor();
        await page.goto(`${portalOrigin}/providers`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "新增 Provider", exact: true }).click();
        await page.locator(".modal").waitFor();
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await page.getByRole("button", { name: "编辑", exact: true }).click();
        await page.locator(".modal").waitFor();
        failedRequest = { path: `/api/admin/providers/${providers[0].id}`, method: "PATCH" };
        await page.locator('.modal button[type="submit"]').click();
        await page.locator(".modal").waitFor({ state: "detached" });
        await page.getByText("Modal request failed", { exact: true }).waitFor();
        failedRequest = null;
        await Promise.all([
          page.waitForRequest(request => request.url().endsWith(`/api/admin/providers/${providers[0].id}/test`) && request.method() === "POST"),
          page.locator(".provider-channel-table").getByRole("button", { name: "测试", exact: true }).click(),
        ]);
        await page.getByText(`${providers[0].name} 检测完成`, { exact: true }).waitFor();

        // A second category verifies that native tabs filter rows and health totals together.
        const providerPattern = "**/api/backend/api/admin/providers";
        const categoryProvider = { ...providers[0], id: "merge_claude_provider", name: "Claude category fixture", options: { model_category: "claude" } };
        await context.route(providerPattern, route => route.fulfill({ json: { data: [...providers, categoryProvider] } }));
        await page.reload();
        await page.waitForLoadState("networkidle");
        const tabs = page.locator(".provider-channel-panel .category-tabs");
        await tabs.getByRole("button", { name: /claude/i }).click();
        assert.equal(await page.locator(".provider-channel-table tbody tr").count(), 1);
        await page.locator(".provider-channel-table").getByText(categoryProvider.name, { exact: true }).waitFor();
        const healthTotal = () => page.locator(".provider-monitor-summary strong").evaluateAll(nodes => nodes.reduce((total, node) => total + Number(node.textContent), 0));
        assert.equal(await healthTotal(), 1);
        await tabs.getByRole("button", { name: /全部/ }).click();
        assert.equal(await page.locator(".provider-channel-table tbody tr").count(), 2);
        assert.equal(await healthTotal(), 2);
        const search = page.getByPlaceholder("搜索名称、ID、状态", { exact: true });
        await search.fill(categoryProvider.name);
        assert.equal(await page.locator(".provider-channel-table tbody tr").count(), 1);
        await search.fill("no-provider-matches-this-query");
        assert.equal(await page.locator(".provider-channel-table").count(), 0);
        await search.clear();
        await page.locator(".provider-channel-table").waitFor();
        if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, "providers-native.png") });
        await context.unroute(providerPattern);

        // A failed monitoring endpoint must not turn an unobserved Provider into a healthy row.
        const monitoringPattern = "**/api/backend/api/admin/providers/monitoring";
        await context.route(monitoringPattern, route => route.fulfill({ status: 404, json: { error: { message: "Native monitoring unavailable" } } }));
        await page.reload();
        await page.getByText("Native monitoring unavailable", { exact: true }).waitFor();
        assert.equal(await page.locator(".provider-channel-table").count(), 0);
        await context.unroute(monitoringPattern);
        await page.reload();
        await page.locator(".provider-monitor-status.unknown").waitFor();
      }
      if (role === "admin" && view === "models") {
        await page.getByRole("button", { name: "管理映射", exact: true }).click();
        const drawer = page.locator(".model-mapping-drawer");
        await drawer.waitFor();
        assert.equal(await page.locator(".model-drawer-backdrop").evaluate(node => globalThis.getComputedStyle(node).position), "fixed", "mapping drawer must overlay the page");
        assert.ok((await drawer.boundingBox()).x > 0, "mapping drawer must align to the right");
        if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, "model-mapping.png") });
        await page.setViewportSize({ width: 390, height: 844 });
        const mobileDrawer = await drawer.boundingBox();
        assert.ok(mobileDrawer.x >= -1 && mobileDrawer.x + mobileDrawer.width <= 391, "mapping drawer must fit a mobile viewport");
        await page.setViewportSize({ width: 1440, height: 1000 });
        await drawer.getByRole("button", { name: "添加线路", exact: true }).click();
        await page.locator(".model-mapping-modal").waitFor();
        assert.equal(await page.locator(".mapping-chain-editor").evaluate(node => globalThis.getComputedStyle(node).display), "grid");
        await page.locator(".model-mapping-modal").getByRole("combobox", { name: /已引入的上游模型/ }).selectOption("merge-upstream");
        failedRequest = { path: "/api/admin/routing-rules", method: "POST" };
        await page.locator('.model-mapping-modal button[type="submit"]').click();
        await page.locator(".model-mapping-modal").waitFor({ state: "detached" });
        await drawer.waitFor({ state: "detached" });
        await page.getByText("Modal request failed", { exact: true }).waitFor();
        failedRequest = null;
        await page.getByRole("button", { name: "新建对外模型", exact: true }).click();
        await page.getByRole("heading", { name: "从模型目录选择", exact: true }).waitFor();
        await page.getByRole("button", { name: "取消", exact: true }).click();
      }
      if (role === "admin" && view === "routes") {
        const sidebar = page.locator(".model-provider-list");
        const sidebarMarkup = await sidebar.innerHTML();
        assert.equal(await page.locator(".route-model-card").count(), 1);
        await page.getByRole("tab", { name: /全部模型/ }).click();
        assert.equal(await page.locator(".route-model-card").count(), 2, "all scope must include unconfigured templates");
        assert.equal(await sidebar.innerHTML(), sidebarMarkup, "model sidebar must remain stable");
        await page.getByRole("tab", { name: /已配置/ }).click();
        assert.equal(await page.locator(".route-model-card").count(), 1);
        await page.getByRole("tab", { name: "固定比例", exact: true }).click();
        await page.getByRole("button", { name: "应用策略", exact: true }).click();
        await page.waitForLoadState("networkidle");
        assert.ok(writes.some(w => w.path.endsWith("/model-routing-policies/merge-smoke-model") && w.body.strategy === "priority_weighted"), "strategy must reach the API");
        await page.getByRole("button", { name: "添加线路", exact: true }).click();
        await page.locator(".modal").waitFor();
        assert.ok(await page.getByText("Provider 模型", { exact: true }).count());
        await page.locator('[data-field-key="provider_model"] select').selectOption("merge-upstream");
        failedRequest = { path: "/api/admin/routing-rules", method: "POST" };
        await page.locator('.modal button[type="submit"]').click();
        await page.locator(".modal").waitFor({ state: "detached" });
        await page.getByText("Modal request failed", { exact: true }).waitFor();
        failedRequest = null;
      }
      if (role === "admin" && view === "routes") {
        await page.locator(".route-row-actions").getByRole("button", { name: "删除", exact: true }).click();
        await page.locator(".confirm-modal").waitFor();
        failedRequest = { path: `/api/admin/routing-rules/${routes[0].id}`, method: "DELETE" };
        await page.locator(".confirm-modal").getByRole("button", { name: "删除", exact: true }).click();
        await page.locator(".confirm-modal").waitFor({ state: "detached" });
        await page.getByText("Modal request failed", { exact: true }).waitFor();
        failedRequest = null;
      }
      if (view === "users" && ["admin", "team_leader"].includes(role)) {
        await page.getByRole("button", { name: "新增用户", exact: true }).click();
        const dialog = page.locator(".platform-account-dialog");
        await dialog.getByLabel("姓名").fill("Fixture user");
        await dialog.getByLabel("用户名").fill("fixture-modal-error");
        await dialog.locator('input[type="password"]').nth(0).fill("fixture-only");
        await dialog.locator('input[type="password"]').nth(1).fill("fixture-only");
        if (role === "admin") await dialog.getByLabel("角色").selectOption("team_leader");
        failedRequest = { path: "/api/admin/users", method: "POST" };
        await dialog.getByRole("button", { name: "确定", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByText("Modal request failed", { exact: true }).waitFor();
        failedRequest = null;
      }
      if (role === "team_leader" && view === "teams") {
        await page.locator(".platform-account-create").click();
        const dialog = page.locator(".team-group-dialog");
        await dialog.getByLabel("分组名称").fill("Fixture group");
        failedRequest = { path: "/api/admin/resources/teams", method: "POST" };
        await dialog.getByRole("button", { name: "确定", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByText("Modal request failed", { exact: true }).waitFor();
        failedRequest = null;
      }
      if (view === "playground") {
        await page.getByRole("combobox", { name: "Model", exact: true }).selectOption(models[0].name);
        if (screenshotDirectory && role === "admin") await page.screenshot({ path: join(screenshotDirectory, "playground-design.png") });
        await page.locator(".playground-composer textarea").fill("Merge smoke prompt");
        await page.locator('.playground-composer button[type="submit"]').click();
        await page.getByText("Merge stream response", { exact: true }).waitFor();
        assert.equal(chats.at(-1).project_id, projects[0].id, "stream request must preserve the project context");
        await page.getByRole("button", { name: "重跑", exact: true }).click();
        await page.waitForLoadState("networkidle");
        assert.equal(chats.length, 2, "rerun must reach the streaming endpoint");
        if (screenshotDirectory && role === "admin") await page.screenshot({ path: join(screenshotDirectory, "playground.png") });
        await page.getByRole("button", { name: "添加对比模型", exact: true }).click();
        await page.getByRole("combobox", { name: "对比模型", exact: true }).selectOption(comparisonModel.name);
        await page.locator(".playground-composer textarea").fill("Compare these models");
        await page.locator('.playground-composer button[type="submit"]').click();
        await page.getByText("Comparison stream response", { exact: true }).waitFor();
        await page.waitForLoadState("networkidle");
        assert.equal(chats.length, 4, "comparison must call the streaming API for both models");
        assert.deepEqual(chats.slice(2).map(chat => chat.model).sort(), [models[0].name, comparisonModel.name].sort());
        assert.ok(chats.slice(2).every(chat => chat.project_id === projects[0].id));
        await page.locator(".playground-composer textarea").fill("Comparison follow up");
        await page.locator('.playground-composer button[type="submit"]').click();
        await page.waitForLoadState("networkidle");
        assert.equal(chats.length, 6);
        const followup = chats.slice(4);
        assert.ok(followup.find(chat => chat.model === comparisonModel.name).messages.some(message => message.content === "Comparison stream response"));
        assert.ok(!followup.find(chat => chat.model === models[0].name).messages.some(message => message.content === "Comparison stream response"));
        const columns = await page.locator(".playground-conversation").all();
        const left = await columns[0].boundingBox();
        const right = await columns[1].boundingBox();
        assert.ok(left.x + left.width <= right.x + 1 && Math.abs(left.y - right.y) < 2, "comparison models must display side by side");
        if (screenshotDirectory && role === "admin") await page.screenshot({ path: join(screenshotDirectory, "playground-compare.png") });
        if (role === "admin") {
          await page.setViewportSize({ width: 390, height: 844 });
          assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 391), "playground must fit a mobile viewport");
          const mobileLeft = await columns[0].boundingBox();
          const mobileRight = await columns[1].boundingBox();
          assert.ok(mobileLeft.y + mobileLeft.height <= mobileRight.y + 1, "mobile comparison must stack vertically");
          assert.ok(await page.locator(".playground-main").evaluate(node => node.scrollHeight <= node.clientHeight + 1), "mobile conversation must not be clipped by its container");
          await page.locator(".playground-composer").scrollIntoViewIfNeeded();
          const mobileComposer = await page.locator(".playground-composer").boundingBox();
          assert.ok(mobileComposer.y >= 0 && mobileComposer.y + mobileComposer.height <= 845, "mobile composer must be reachable by scrolling");
          if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, "playground-compare-mobile.png"), fullPage: true });
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
        await page.getByRole("button", { name: "取消对比", exact: true }).click();
        assert.equal(await page.locator(".playground-conversation").count(), 1);
      }
      if (view === "usage") {
        await page.getByRole("heading", { name: "当天用量", exact: true }).waitFor();
      }
    }
    assert.deepEqual(errors, [], `${role}: browser errors`);
    console.log(`${role}: ${pages.length} pages passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
