import { test, expect, capture } from "./harness";
import { model, user } from "./fixtures/shell";
import { usageReport } from "./fixtures/global-usage";

test.use({ sessionUser: { ...user, role: "consumer" } });

test("prepaid playground preserves a rejected draft and links to recharge", async ({ page, api }, info) => {
  api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [{ id: "key_ui", name: "Prepaid key", project_id: "prj_ui", owner_user_id: user.id, status: "active" }] } }), query => {
    expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "1000", limit: "1000" });
  });
  api.respond("GET", "/api/admin/consumer/wallet", { balance_fen: 10, held_fen: 0, available_fen: 10, balance_micros: 100000, balance_cents: 10, packages_cents: [1000, 5000, 10000], min_amount_cents: 100, max_amount_cents: 5000000, simulated_payment: true });
  api.respond("GET", "/api/admin/wallet", { prepaid_usage: true, balance_micros: 100000, available_micros: 100000 });
  api.define("POST", "/api/admin/playground/chat/stream", () => ({
    status: 402, json: { error: { code: "wallet_insufficient_balance", message: "Insufficient wallet balance" } },
  }));
  api.respond("GET", "/api/admin/recharge/plans", { data: [{ id: "test", name: "Test recharge", amount_fen: 1000 }], channels: ["wechat"] });
  api.define("GET", "/api/admin/wallet/usage", () => ({ json: { data: [] } }), query => { expect(Object.fromEntries(query)).toEqual({ limit: "10", offset: "0" }); });
  api.define("GET", "/api/admin/recharge/orders", () => ({ json: { data: [] } }), query => { expect(Object.fromEntries(query)).toEqual({ limit: "10", offset: "0" }); });
  api.define("POST", "/api/admin/recharge/orders", ({ body }) => {
    expect(body).toEqual({ plan_id: "test", channel: "wechat" });
    return { status: 201, json: { order_no: "test-order", status: "pending", qr_code: "weixin://test/checkout" } };
  });
  api.respond("GET", "/api/admin/recharge/orders/test-order", { order_no: "test-order", status: "succeeded" });

  await page.goto("/playground/");
  await expect(page.getByText("演练场按实际用量扣费")).toBeVisible();
  const draft = page.getByPlaceholder("输入用于诊断模型的消息...");
  await draft.fill("Keep this question");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByText("当前余额不足以发送这条消息")).toBeVisible();
  await expect(draft).toHaveValue("Keep this question");
  await capture(page, info, page.locator(".playground-composer"), "prepaid-insufficient-balance", "余额不足时保留消息");
  await page.getByRole("button", { name: "去充值" }).click();
  await page.getByRole("button", { name: "创建充值订单" }).click();
  await expect(page.locator("canvas[title='支付二维码']")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "充值已到账" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "账户余额充值", exact: true })).toHaveCount(0);
  await capture(page, info, page.locator(".payment-workspace"), "consumer-balance-recharge", "Consumer balance recharge", "viewport");
  await page.getByRole("button", { name: "继续充值", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建充值订单", exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`consumer balance recharge supports ${theme} theme`, async ({ context, page, api }, info) => {
    await context.addInitScript(value => localStorage.setItem("tokenhub.theme", value), theme);
    api.respond("GET", "/api/admin/wallet", { balance_micros: 50000000, available_micros: 50000000 });
    api.respond("GET", "/api/admin/recharge/plans", { data: [{ id: "ten", amount_fen: 1000 }, { id: "fifty", amount_fen: 5000 }, { id: "hundred", amount_fen: 10000 }], custom_enabled: true, min_fen: 1, max_fen: 500000, channels: ["wechat", "alipay"] });
    for (const path of ["/api/admin/wallet/usage", "/api/admin/recharge/orders"]) {
      api.define("GET", path, () => ({ json: { data: [], total: 0 } }), query => expect(Object.fromEntries(query)).toEqual({ limit: "10", offset: "0" }));
    }
    api.define("POST", "/api/admin/recharge/orders", ({ body }) => {
      expect(body).toEqual({ plan_id: "", channel: "wechat", amount_fen: 2500 });
      return { json: { order_no: "theme-order", amount_fen: 2500, channel: "wechat", status: "pending", qr_code: "weixin://synthetic-theme-checkout" } };
    });
    api.respond("GET", "/api/admin/recharge/orders/theme-order", { order_no: "theme-order", amount_fen: 2500, channel: "wechat", status: "pending", qr_code: "weixin://synthetic-theme-checkout" });
    await page.goto("/balance-recharge/");
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".payment-amount-options button")).toHaveCount(4);
    await page.getByRole("button", { name: "自定义金额", exact: true }).click();
    await page.getByRole("spinbutton", { name: "自定义金额", exact: true }).fill("25");
    await page.getByRole("button", { name: "微信支付", exact: true }).click();
    await expect(page.getByRole("button", { name: "微信支付", exact: true })).toHaveAttribute("aria-pressed", "true");
    await capture(page, info, page.locator(".payment-workspace"), `recharge-${theme}-desktop`, `Recharge ${theme} theme`, "viewport");
    await page.getByRole("button", { name: "创建充值订单", exact: true }).click();
    await expect(page.locator("canvas[title='支付二维码']")).toBeVisible();
    await capture(page, info, page.locator(".payment-workspace"), `recharge-${theme}-checkout`, `Recharge ${theme} checkout`, "viewport");
    await page.getByRole("button", { name: "返回充值选择", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".recharge-summary").scrollIntoViewIfNeeded();
    await capture(page, info, page.locator(".payment-workspace"), `recharge-${theme}-mobile`, `Mobile recharge ${theme}`, "viewport");
  });
}

test("consumer cost cards adapt without project costs", async ({ page, api }, info) => {
  const report = usageReport("30d");
  report.breakdown.api_keys = [{ id: "key_ui_cost", ...report.summary }];
  api.define("GET", "/api/admin/usage/report", () => ({ json: report }), query => {
    expect(Object.fromEntries(query)).toEqual({ range: "30d" });
  });
  api.respond("GET", "/api/admin/consumer/wallet", { balance_cents: 5000 });
  api.respond("GET", "/api/admin/wallet", { balance_micros: 50000000, available_micros: 50000000 });
  api.define("GET", "/api/admin/recharge/orders", () => ({ json: { data: [{ order_no: "real-payment", amount_fen: 1234, channel: "alipay", status: "succeeded", created_at: 1794700800 }], total: 1 } }), query => { expect(Object.fromEntries(query)).toEqual({ limit: "10", offset: "0" }); });
  await page.goto("/billing/");
  await expect(page.locator(".cost-details").getByText("¥12.34", { exact: true })).toBeVisible();
  await expect(page.locator(".cost-details").getByText("已支付", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目成本", exact: true })).toHaveCount(0);
  await expect(page.locator(".cost-details-grid .cost-panel")).toHaveCount(2);
  const costAmount = "¥21.50";
  await expect(page.locator(".cost-kpi.is-balance strong")).toHaveText("¥50.00");
  await expect(page.locator(".cost-kpi.is-purple strong")).toHaveText(costAmount);
  await expect(page.locator(".cost-details-grid .cost-money")).toHaveText([costAmount, costAmount]);
  await expect(page.locator(".cost-details")).not.toContainText("USD");
  await expect(page.getByText(report.breakdown.models[0].id, { exact: true })).toBeVisible();
  const cards = page.locator(".cost-details-grid .cost-panel");
  const modelBounds = await cards.nth(0).boundingBox();
  const keyBounds = await cards.nth(1).boundingBox();
  expect(Math.abs(modelBounds!.y - keyBounds!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(modelBounds!.width - keyBounds!.width)).toBeLessThanOrEqual(1);
  await capture(page, info, page.locator(".cost-details"), "consumer-cost-desktop", "Consumer cost details", "viewport");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileModel = await cards.nth(0).boundingBox();
  const mobileKey = await cards.nth(1).boundingBox();
  expect(mobileKey!.y).toBeGreaterThanOrEqual(mobileModel!.y + mobileModel!.height);
  expect(Math.abs(mobileModel!.x - mobileKey!.x)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, info, page.locator(".cost-details"), "consumer-cost-mobile", "Consumer cost details on mobile", "viewport");
});

test.describe("wallet reconciliation", () => {
  test.use({ sessionUser: user });

  test("platform operators confirm a pending wallet settlement", async ({ page, api }) => {
    api.respond("GET", "/api/admin/payment-orders", { data: [] });
    let settled = false;
    api.define("GET", "/api/admin/payment-wallet/usage", () => ({
      json: { data: settled ? [] : [{ request_id: "pending-chat", model: model.name, reserved_micros: 1000 }] },
    }), (query) => {
      expect(query.get("status")).toBe("pending_review");
      expect(query.get("request_id")).toBe(null);
    });
    api.define("POST", "/api/admin/payment-wallet/usage/pending-chat/resolve", ({ body }) => {
      expect(body).toEqual({ charged_micros: 300, reason: "Verified fixture usage" });
      settled = true;
      return { json: { status: "settled" } };
    });

    await page.goto("/billing/");
    await page.getByRole("tab", { name: "支付与钱包对账", exact: true }).click();
    await page.getByRole("button", { name: "待结算请求", exact: true }).click();
    await page.getByRole("button", { name: "结算待核对请求", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("扣费金额（元）").fill("0.0003");
    await dialog.getByLabel("对账或退款原因").fill("Verified fixture usage");
    await dialog.getByRole("button", { name: "结算待核对请求", exact: true }).click();
    expect(settled).toBe(false);
    await dialog.getByRole("button", { name: "确认钱包结算", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("pending-chat", { exact: true })).toHaveCount(0);
    expect(settled).toBe(true);
  });
});
