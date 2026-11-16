import type { Page } from "@playwright/test";
import { test, expect, capture } from "./harness";
import { fixedTime, user } from "./fixtures/shell";
import type { MockRequest } from "./network";
import { usageReport } from "./fixtures/global-usage";

const team = { id: "team_ui_wallet", name: "Synthetic Wallet Team", status: "active", fields: { owner: user.id }, created_at: fixedTime, updated_at: fixedTime };
const walletPath = `/api/admin/teams/${team.id}/wallet`;

test.describe("team-wallet report overview", () => {
  test.use({ sessionUser: { ...user, role: "team_leader", team_id: team.id } });
  for (const mobile of [false, true]) {
    test(`team-wallet report ${mobile ? "mobile" : "desktop"} hierarchy`, async ({ page, api }, info) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [] } }), query => { expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "1000", limit: "1000" }); });
      api.respond("GET", walletPath, { wallet: { team_id: team.id, balance_cents: 400000 }, currency: "CNY", paid_calls_enabled: false });
      api.define("GET", `${walletPath}/ledger`, () => ({ json: { entries: [], total: 0, limit: 20, offset: 0, currency: "CNY" } }), query => {
        expect(Object.fromEntries(query)).toEqual({ limit: "20", offset: "0" });
      });
      api.define("GET", "/api/admin/usage/report", () => ({ json: usageReport("today") }), query => { expect(query.get("range")).toBe("today"); });
      await page.goto("/usage");
      const overview = page.locator(".team-wallet-overview");
      await expect(overview.getByText("结算配置未完成，请联系管理员", { exact: true })).toBeVisible();
      await expect(overview.locator(".team-wallet-balance strong")).toContainText("4,000.00");
      await expect(overview.getByText("暂无资金流水", { exact: true })).toBeVisible();
      expect(await overview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const layout = await overview.locator(".team-wallet-balance strong").evaluate(element => ({ fontSize: parseFloat(getComputedStyle(element).fontSize), bottom: element.getBoundingClientRect().bottom }));
      expect(layout.fontSize).toBeGreaterThanOrEqual(24);
      if (mobile) expect((await overview.locator(".team-wallet-status").boundingBox())!.y).toBeGreaterThan(layout.bottom);
      await capture(page, info, overview, `team-wallet-report-${mobile ? "mobile" : "desktop"}`, "团队报表：钱包余额与资金流水");
    });
  }
});

async function enterTeams(page: Page) {
  await page.route("**/*", route => route.request().method() === "HEAD" && new URL(route.request().url()).pathname === "/teams/" ? route.fulfill({ status: 200, body: "" }) : route.fallback());
  await page.goto("/teams");
  await expect(page.getByText(team.name, { exact: true }).first()).toBeVisible();
}

test.beforeEach(async ({ context, api }) => {
  await context.route("**/{icon.svg,icons/sprite.svg}", route => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" />' }));
  api.respond("POST", "/api/admin/auth/login", { token: "ui-fixture-token", user, expires_at: "2099-01-01T00:00:00Z" });
  api.respond("GET", "/api/admin/users", { data: [user] });
  api.respond("GET", "/api/admin/resources/teams", { data: [team] });
  api.respond("GET", "/api/admin/resources/cost-centers", { data: [] });
});

test("team-wallet funding posts once and displays the immutable ledger", async ({ page, api }, testInfo) => {
  let balance = 12345;
  api.define("GET", walletPath, () => ({ json: { wallet: { team_id: team.id, balance_cents: balance, updated_at: fixedTime }, currency: "CNY", paid_calls_enabled: true } }));
  await enterTeams(page);
  await page.getByRole("button", { name: "入账", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "团队名称", exact: true })).toHaveValue(team.name);
  await expect(dialog.getByRole("option", { name: "线下收款", exact: true })).toBeAttached();
  await expect(dialog.getByRole("option", { name: "授信入账", exact: true })).toBeAttached();
  expect(api.calls.filter(call => call.method === "POST" && call.path === `${walletPath}/credits`)).toHaveLength(0);
  await expect(dialog.getByRole("button", { name: "确认入账", exact: true })).toBeDisabled();
  await capture(page, testInfo, dialog, "team-wallet-funding", "团队钱包线下入账表单");
  await dialog.getByRole("textbox", { name: "入账金额（元）", exact: true }).fill("25.50");
  await dialog.getByRole("textbox", { name: "备注（必填，最多1000字）", exact: true }).fill("Synthetic offline receipt UI-001");
  await dialog.getByRole("checkbox").check();
  let recorded: Record<string, unknown> | undefined;
  api.define("POST", `${walletPath}/credits`, (call: MockRequest) => {
    recorded = call.body as Record<string, unknown>;
    balance += Number(recorded.amount_cents);
    return { json: { currency: "CNY", entry: { id: "credit_ui_1", team_id: team.id, ...recorded, actor_user_id: user.id, before_balance_cents: 12345, after_balance_cents: balance, created_at: fixedTime } } };
  });
  await dialog.getByRole("button", { name: "确认入账", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(recorded).toMatchObject({ amount_cents: 2550, credit_type: "offline_receipt", remark: "Synthetic offline receipt UI-001" });
  expect(recorded?.request_id).toEqual(expect.any(String));
  expect(api.calls.filter(call => call.method === "POST" && call.path === `${walletPath}/credits`)).toHaveLength(1);
  api.define("GET", `${walletPath}/ledger`, () => ({ json: { entries: [{ id: "credit_ui_1", kind: "credit", status: "credited", team_id: team.id, ...recorded, actor_user_id: user.id, before_balance_cents: 12345, after_balance_cents: balance, created_at: fixedTime }], total: 1, limit: 20, offset: 0, currency: "CNY" } }), query => { expect(query.get("limit")).toBe("20"); expect(query.get("offset")).toBe("0"); });
  await page.getByRole("button", { name: "资金流水", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Synthetic offline receipt UI-001", { exact: true })).toBeVisible();
  const ledgerLayout = await page.getByRole("dialog").locator("table").evaluate(table => ({ width: table.getBoundingClientRect().width, cellWhiteSpace: getComputedStyle(table.querySelector("td")!).whiteSpace }));
  expect(ledgerLayout.width).toBeGreaterThanOrEqual(1100);
  expect(ledgerLayout.cellWhiteSpace).toBe("nowrap");
  await capture(page, testInfo, page.getByRole("dialog"), "team-wallet-ledger", "团队钱包不可编辑资金流水");
});

test("team-wallet ledger failure retries to a genuine empty state", async ({ page, api }, testInfo) => {
  api.respond("GET", walletPath, { wallet: { team_id: team.id, balance_cents: 0 }, currency: "CNY" });
  let reads = 0;
  api.define("GET", `${walletPath}/ledger`, () => ++reads === 1 ? { status: 404, json: { error: { code: "route_not_found" } } } : { json: { entries: [], total: 0, limit: 20, offset: 0, currency: "CNY" } }, query => { expect(query.get("limit")).toBe("20"); expect(query.get("offset")).toBe("0"); });
  await enterTeams(page);
  await page.getByRole("button", { name: "资金流水", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("钱包接口不可用，请确认后端已升级并启用钱包功能");
  await expect(dialog.getByText("暂无资金流水", { exact: true })).toHaveCount(0);
  await capture(page, testInfo, dialog, "team-wallet-ledger-unavailable", "钱包接口不可用与安全重试");
  await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(dialog.getByText("暂无资金流水", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
});

test("team-wallet balance recovery enables a confirmed credit with zero balance", async ({ page, api }, testInfo) => {
  let recovered = false;
  api.define("GET", walletPath, () => recovered ? { json: { wallet: { team_id: team.id, balance_cents: 0 }, currency: "CNY" } } : { status: 503, json: { error: "Synthetic balance failure" } });
  await enterTeams(page);
  await page.getByRole("button", { name: "入账", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "入账金额（元）", exact: true }).fill("1.00");
  await dialog.getByRole("textbox", { name: "备注（必填，最多1000字）", exact: true }).fill("Synthetic recovered receipt");
  await expect(dialog.getByText("请等待余额成功加载后再确认入账", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认入账", exact: true })).toBeDisabled();
  recovered = true;
  await dialog.getByRole("button", { name: "余额加载失败，重试", exact: true }).click();
  await expect(dialog.getByText("请先勾选核实收款或授信信息", { exact: true })).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await expect(dialog.getByRole("button", { name: "确认入账", exact: true })).toBeEnabled();
  expect(api.calls.filter(call => call.method === "POST" && call.path === `${walletPath}/credits`)).toHaveLength(0);
  await capture(page, testInfo, dialog, "team-wallet-zero-balance-recovered", "零余额恢复与入账确认条件");
});

test("team-wallet uncertain response reconciles the original request after reopening", async ({ page, api }) => {
  api.respond("GET", walletPath, { wallet: { team_id: team.id, balance_cents: 10000, updated_at: fixedTime }, currency: "CNY", paid_calls_enabled: true });
  let recorded: Record<string, unknown> | undefined;
  api.define("POST", `${walletPath}/credits`, (call: MockRequest) => { recorded = call.body as Record<string, unknown>; return { status: 503, json: { error: "Synthetic uncertain response" } }; });
  api.define("GET", `${walletPath}/ledger`, () => ({ json: { entries: recorded ? [{ id: "credit_ui_reconciled", kind: "credit", status: "credited", team_id: team.id, ...recorded, actor_user_id: user.id, before_balance_cents: 10000, after_balance_cents: 10100, created_at: fixedTime }] : [], total: recorded ? 1 : 0, limit: 20, offset: 0, currency: "CNY" } }), query => { expect(query.get("request_id")).toEqual(recorded?.request_id); expect(query.get("limit")).toBe("20"); expect(query.get("offset")).toBe("0"); });
  await enterTeams(page);
  await page.getByRole("button", { name: "入账", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "入账金额（元）", exact: true }).fill("1.00");
  await dialog.getByRole("textbox", { name: "备注（必填，最多1000字）", exact: true }).fill("Synthetic uncertain receipt");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "确认入账", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("结果尚未确认");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "入账", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "入账金额（元）", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "使用原请求重试", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.calls.filter(call => call.method === "POST" && call.path === `${walletPath}/credits`)).toHaveLength(1);
  const reconciliation = api.calls.find(call => call.path === `${walletPath}/ledger`);
  expect(reconciliation?.query.get("request_id")).toEqual(recorded?.request_id);
});
