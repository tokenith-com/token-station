import { test, expect, capture } from "./harness";
import { user } from "./fixtures/shell";

test.use({ sessionUser: { ...user, role: "consumer" } });
const paid = { order_no: "TS-receipt-fixture", status: "succeeded", amount_fen: 1000, channel: "alipay", created_at: 1794700800 };
test.beforeEach(async ({ api }) => {
  api.respond("GET", "/api/admin/wallet", { balance_micros: 10000000, available_micros: 10000000 });
  api.respond("GET", "/api/admin/wallet/usage", { data: [] });
  api.respond("GET", "/api/admin/recharge/plans", { data: [{ id: "ten", amount_fen: 1000 }], channels: ["wechat", "alipay"] });
  api.respond("GET", "/api/admin/recharge/orders", { data: [paid] });
  api.respond("GET", "/api/admin/recharge/orders/TS-receipt-fixture", paid);
});
test("avatar recharge entry opens checkout from another page", async ({ page }) => {
  await page.goto("/models/");
  await page.getByRole("button", { name: "个人中心", exact: true }).click();
  await page.getByRole("menuitem", { name: "余额充值", exact: true }).click();
  await expect(page).toHaveURL(/\/balance-recharge\/?$/);
  await expect(page.getByRole("button", { name: "创建充值订单", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "支付宝", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "支付方式" })).toHaveCount(0);
});
test("merchant return displays a verified receipt and can start another recharge", async ({ page }, info) => {
  await page.goto("/balance-recharge/?payment_order=TS-receipt-fixture");
  await expect(page.locator(".payment-result").getByRole("status")).toHaveText("充值已到账");
  await expect(page.locator(".payment-result")).toContainText("支付宝");
  await expect(page.locator(".payment-result-amount")).toHaveText("¥10.00");
  await expect(page.getByRole("button", { name: "刷新订单状态" })).toHaveCount(0);
  await expect(page.locator(".payment-form")).toHaveCount(0);
  await capture(page, info, page.locator(".payment-workspace"), "recharge-paid", "Verified recharge receipt", "viewport");
  await page.getByRole("button", { name: "切换到深色模式", exact: true }).click();
  await capture(page, info, page.locator(".payment-workspace"), "recharge-paid-dark", "Dark recharge receipt", "viewport");
  await page.getByRole("button", { name: "切换到浅色模式", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".payment-table-scroll").getByRole("button", { name: "查看详情" })).toBeInViewport();
  await expect.poll(() => page.locator(".payment-table-scroll").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await capture(page, info, page.locator(".payment-workspace"), "recharge-paid-mobile", "Mobile recharge receipt", "viewport");
  await page.getByRole("button", { name: "继续充值", exact: true }).click();
  await expect(page).not.toHaveURL(/payment_order/);
  await expect(page.getByRole("button", { name: "创建充值订单" })).toBeVisible();
});
