import { test, expect, capture } from "./harness";
import { model, user } from "./fixtures/shell";

test.use({ sessionUser: { ...user, role: "consumer" } });

test("prepaid playground preserves a rejected draft and links to recharge", async ({ page, api }, info) => {
  api.define("GET", "/api/admin/api-keys", () => ({ json: { data: [{ id: "key_ui", name: "Prepaid key", project_id: "prj_ui", owner_user_id: user.id, status: "active" }] } }), query => {
    expect(Object.fromEntries(query)).toEqual({ page: "1", page_size: "1000", limit: "1000" });
  });
  api.respond("GET", "/api/admin/consumer/wallet", { balance_fen: 10, held_fen: 0, available_fen: 10, balance_micros: 100000 });
  api.respond("GET", "/api/admin/wallet", { prepaid_usage: true, balance_micros: 100000, available_micros: 100000 });
  api.define("POST", "/api/admin/playground/chat/stream", () => ({
    status: 402, json: { error: { code: "wallet_insufficient_balance", message: "Insufficient wallet balance" } },
  }));
  api.respond("GET", "/api/admin/recharge/plans", { data: [{ id: "test", name: "Test recharge", amount_fen: 1000 }], channels: ["wechat"] });
  api.respond("GET", "/api/admin/wallet/usage", { data: [] });
  api.respond("GET", "/api/admin/recharge/orders", { data: [] });
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
  await page.getByRole("button", { name: "刷新订单状态" }).click();
  await expect(page.getByRole("status").filter({ hasText: "充值已到账" })).toBeVisible();
  await page.getByRole("button", { name: "账户余额充值", exact: true }).click();
  await expect(page.getByText("为您的账户充值，享受更多服务", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "账户余额充值", exact: true })).toHaveAttribute("aria-pressed", "true");
  await capture(page, info, page.locator(".recharge-view"), "consumer-balance-recharge", "Consumer balance recharge", "viewport");
  await page.getByRole("button", { name: "在线支付充值", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建充值订单", exact: true })).toBeVisible();
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
      expect(query.get("request_id")).toBe(settled ? "pending-chat" : null);
    });
    api.define("POST", "/api/admin/payment-wallet/usage/pending-chat/resolve", ({ body }) => {
      expect(body).toEqual({ charged_micros: 300, reason: "Verified fixture usage" });
      settled = true;
      return { json: { status: "settled" } };
    });

    await page.goto("/billing/");
    await page.getByRole("button", { name: "查询支付与待结算请求" }).click();
    await page.getByRole("button", { name: "pending-chat" }).click();
    await page.getByLabel("扣费金额（百万分之一元）").fill("300");
    await page.getByLabel("对账或退款原因").fill("Verified fixture usage");
    await page.getByRole("button", { name: "结算待核对请求" }).click();
    expect(settled).toBe(false);
    await page.getByRole("button", { name: "确认钱包结算" }).click();
    await expect(page.getByRole("button", { name: "pending-chat" })).toHaveCount(0);
    expect(settled).toBe(true);
  });
});
