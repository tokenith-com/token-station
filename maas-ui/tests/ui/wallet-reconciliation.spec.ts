import { test, expect, capture } from "./harness";

test("wallet reconciliation refunds a selected order only after confirmation", async ({ page, api }, info) => {
  let refunds = 0;
  api.define("GET", "/api/admin/payment-orders", () => ({ json: { data: [
    { order_no: "order-complete", amount_fen: 1000, channel: "alipay", status: refunds ? "refund_pending" : "succeeded" },
    { order_no: "order-pending", amount_fen: 5000, channel: "wechat", status: "pending" },
  ] } }));
  api.define("GET", "/api/admin/payment-wallet/usage", () => ({ json: { data: [] } }), query => expect(query.get("status")).toBe("pending_review"));
  api.define("POST", "/api/admin/payment-orders/order-complete/refunds", ({ body }) => {
    expect(body).toEqual({ reason: "Verified duplicate top-up" }); refunds++;
    return { json: { status: "refund_pending" } };
  });
  await page.goto("/billing/");
  await page.getByRole("tab", { name: "支付与钱包对账", exact: true }).click();
  const paid = page.getByRole("row").filter({ hasText: "order-complete" });
  const pending = page.getByRole("row").filter({ hasText: "order-pending" });
  await expect(pending.getByRole("button", { name: "申请全额退款" })).toBeDisabled();
  await capture(page, info, page.getByRole("tabpanel", { name: "支付与钱包对账", exact: true }), "wallet-order-list", "Payment order reconciliation", "viewport");
  await page.getByRole("button", { name: "切换到深色模式", exact: true }).click();
  await paid.getByRole("button", { name: "申请全额退款" }).click();
  const dialog = page.getByRole("dialog", { name: "申请全额退款", exact: true });
  await expect(dialog).toHaveCSS("background-color", "rgb(20, 20, 25)");
  await dialog.getByLabel("对账或退款原因").fill("Verified duplicate top-up");
  await dialog.getByRole("button", { name: "申请全额退款", exact: true }).click();
  expect(refunds).toBe(0);
  await capture(page, info, dialog, "wallet-refund-confirmation", "Refund confirmation");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await capture(page, info, dialog, "wallet-refund-mobile", "Mobile refund confirmation");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  expect(refunds).toBe(0);
  await paid.getByRole("button", { name: "申请全额退款" }).click();
  await dialog.getByLabel("对账或退款原因").fill("Verified duplicate top-up");
  await dialog.getByRole("button", { name: "申请全额退款", exact: true }).click();
  await dialog.getByRole("button", { name: "确认全额退款", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(paid).toContainText("退款处理中");
  expect(refunds).toBe(1);
});
