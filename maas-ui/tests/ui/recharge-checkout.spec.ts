import { test, expect, capture } from "./harness";
import { user } from "./fixtures/shell";

test.use({ sessionUser: { ...user, role: "consumer" } });
const paid = { order_no: "TS-receipt-fixture", status: "succeeded", amount_fen: 1000, channel: "alipay", created_at: 1794700800 };
test.beforeEach(async ({ api }, info) => {
  api.respond("GET", "/api/admin/wallet", { balance_micros: 10000000, available_micros: 10000000 });
  const paged = info.title.startsWith("recharge history pages");
  const histories = [
    ["/api/admin/recharge/orders", paged ? Array.from({ length: 25 }, (_, index) => ({ ...paid, order_no: `order-${index}` })) : [paid]],
    ["/api/admin/wallet/usage", paged ? Array.from({ length: 23 }, (_, index) => ({ request_id: `request-${index}`, model: "fixture-model", status: "settled", charged_micros: 10000 })) : []],
  ] as const;
  for (const [path, rows] of histories) {
    api.define("GET", path, ({ query }) => ({ json: { data: rows.slice(Number(query.get("offset")), Number(query.get("offset")) + Number(query.get("limit"))), total: rows.length } }), query => {
      expect([...query.keys()].sort()).toEqual(["limit", "offset"]);
      expect(Number(query.get("limit"))).toBe(10);
      expect([0, 10, 20]).toContain(Number(query.get("offset")));
    });
  }
  api.respond("GET", "/api/admin/recharge/plans", { data: [{ id: "ten", amount_fen: 1000 }], channels: ["wechat", "alipay"] });
  api.respond("GET", "/api/admin/recharge/orders/TS-receipt-fixture", paid);
});
test("avatar recharge entry opens checkout from another page", async ({ page }, info) => {
  await page.goto("/models/");
  await page.getByRole("button", { name: "个人中心", exact: true }).click();
  await page.getByRole("menuitem", { name: "余额充值", exact: true }).click();
  await expect(page).toHaveURL(/\/balance-recharge\/?$/);
  await expect(page.getByRole("button", { name: "创建充值订单", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "支付宝", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "支付方式" })).toHaveCount(0);
  const guide = page.getByRole("complementary", { name: "充值流程" });
  await expect(guide.getByRole("listitem")).toHaveCount(4);
  await expect(page.locator(".recharge-summary strong")).toHaveText("¥10.00");
  await page.getByRole("button", { name: "支付宝", exact: true }).click();
  await expect(page.getByRole("button", { name: "支付宝", exact: true })).toHaveAttribute("aria-pressed", "true");
  const main = await page.locator(".payment-checkout-main").boundingBox();
  const sidebar = await guide.boundingBox();
  expect(sidebar!.x).toBeGreaterThan(main!.x + main!.width);
  await capture(page, info, page.locator(".payment-workspace"), "recharge-selection", "Recharge selection and guide", "viewport");
  await page.getByRole("button", { name: "切换到深色模式", exact: true }).click();
  await capture(page, info, page.locator(".payment-workspace"), "recharge-selection-dark", "Dark recharge selection", "viewport");
  await page.getByRole("button", { name: "切换到浅色模式", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "创建充值订单", exact: true })).toBeVisible();
  await capture(page, info, page.locator(".payment-workspace"), "recharge-selection-mobile", "Mobile recharge selection", "viewport");
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
  await page.locator(".payment-history-table").getByRole("button", { name: "查看详情" }).scrollIntoViewIfNeeded();
  await expect(page.locator(".payment-history-table").getByRole("button", { name: "查看详情" })).toBeInViewport();
  await expect.poll(() => page.locator(".payment-history-table").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
  await capture(page, info, page.locator(".payment-workspace"), "recharge-paid-mobile", "Mobile recharge receipt", "viewport");
  await page.getByRole("button", { name: "继续充值", exact: true }).click();
  await expect(page).not.toHaveURL(/payment_order/);
  await expect(page.getByRole("button", { name: "创建充值订单" })).toBeVisible();
});

test("recharge history pages and custom amount stays inside the form", async ({ page, api }, info) => {
  api.replaceResponse("GET", "/api/admin/recharge/plans", { data: [], custom_enabled: true, min_fen: 1, max_fen: 500000, channels: ["alipay"] });
  await page.goto("/balance-recharge/");
  const input = page.getByRole("spinbutton", { name: "自定义金额" });
  await expect(input).toBeVisible();
  const label = page.locator(".payment-custom-amount");
  const inputBox = await input.boundingBox();
  const hintBox = await label.locator("small").boundingBox();
  const methodsBox = await page.locator(".payment-channel-options").boundingBox();
  expect(inputBox!.width).toBeLessThanOrEqual(320);
  expect(hintBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
  expect(hintBox!.y + hintBox!.height).toBeLessThan(methodsBox!.y);
  await capture(page, info, page.locator(".payment-workspace"), "recharge-custom-layout", "Custom amount and payment method spacing", "viewport");
  const orders = page.getByRole("region", { name: "充值订单", exact: true });
  await expect(orders.locator("tbody tr")).toHaveCount(10);
  await orders.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(orders.locator("tbody tr")).toHaveCount(10);
  await orders.getByRole("button", { name: "最后一页", exact: true }).click();
  await expect(orders.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "消费流水", exact: true })).toHaveCount(0);
  expect(api.calls.some(call => call.path === "/api/admin/wallet/usage")).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await input.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, info, page.locator(".payment-workspace"), "recharge-custom-mobile", "Mobile custom amount spacing", "viewport");
});
