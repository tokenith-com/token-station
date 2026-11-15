import { test, expect, capture } from "./harness";
import { user } from "./fixtures/shell";

const settings = { plans: [{ id: "ten", name: "Standard", amount_fen: 1000, disabled: false }], custom_enabled: false, min_fen: 100, max_fen: 5000000 };

test.describe("recharge administration", () => {
  test.use({ sessionUser: { ...user, role: "system_admin" } });
  test("system administrators configure recharge plans and custom limits", async ({ page, api }, info) => {
    api.respond("GET", "/api/admin/recharge/settings", settings);
    let saved = false;
    api.define("PUT", "/api/admin/recharge/settings", ({ body }) => {
      expect(body).toEqual({ ...settings, custom_enabled: true, min_fen: 123 });
      saved = true;
      return { json: body };
    });
    await page.goto("/billing/");
    await page.getByRole("button", { name: "配置充值档位" }).click();
    await page.getByLabel("允许自定义充值金额").check();
    await page.getByLabel("最低金额（元）", { exact: true }).fill("1.23");
    await page.getByRole("button", { name: "保存充值设置" }).click();
    await expect(page.getByRole("status").filter({ hasText: "充值设置已保存" })).toBeVisible();
    expect(saved).toBe(true);
    await capture(page, info, page.getByRole("region", { name: "充值设置" }), "recharge-settings", "Recharge configuration", "viewport");
  });
});

test.describe("custom recharge", () => {
  test.use({ sessionUser: { ...user, role: "consumer" } });
  test("consumers select plans or enter a bounded custom amount", async ({ page, api }, info) => {
    api.respond("GET", "/api/admin/consumer/wallet", { balance_fen: 0, available_fen: 0 });
    api.respond("GET", "/api/admin/wallet", { balance_micros: 0, available_micros: 0 });
    api.respond("GET", "/api/admin/wallet/usage", { data: [] });
    api.respond("GET", "/api/admin/recharge/orders", { data: [] });
    api.respond("GET", "/api/admin/recharge/plans", { data: settings.plans, custom_enabled: true, min_fen: 100, max_fen: 5000, channels: ["wechat"] });
    api.define("POST", "/api/admin/recharge/orders", ({ body }) => {
      expect(body).toEqual({ plan_id: "", channel: "wechat", amount_fen: 1234 });
      return { status: 201, json: { order_no: "custom-fixture", status: "pending", qr_code: "weixin://fixture" } };
    });
    api.respond("GET", "/api/admin/recharge/orders/custom-fixture", { order_no: "custom-fixture", status: "succeeded" });
    await page.goto("/balance-recharge/");
    await expect(page.getByRole("combobox", { name: "充值金额", exact: true })).toHaveValue("ten");
    await page.getByRole("combobox", { name: "充值金额", exact: true }).selectOption("");
    const amount = page.getByRole("spinbutton", { name: "自定义金额" });
    await amount.fill("0.99");
    await expect(page.getByRole("button", { name: "创建充值订单" })).toBeDisabled();
    await amount.fill("50.01");
    await expect(page.getByRole("button", { name: "创建充值订单" })).toBeDisabled();
    await amount.fill("12.34");
    await capture(page, info, page.locator(".payment-workspace"), "custom-recharge", "Custom recharge amount", "viewport");
    await page.getByRole("button", { name: "创建充值订单" }).click();
    await expect(page.locator("canvas[title='支付二维码']")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "充值已到账" })).toBeVisible({ timeout: 10000 });
  });
});
