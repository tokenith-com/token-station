import { capture, expect, test } from "./harness";
import type { MockAPI } from "./network";
import { user } from "./fixtures/shell";
import { usageReport } from "./fixtures/global-usage";

test.use({ sessionUser: { ...user, role: "consumer" } });

function orders(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    order_no: `history-order-${index}`, amount_fen: 100 + index, channel: "alipay",
    status: "succeeded", created_at: 1794700800 + index,
  }));
}

function consumption(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    request_id: `history-request-${index}`, model: "history-fixture-model",
    status: "settled", charged_micros: 10000, created_at: 1794700800 + index,
  }));
}

function history(api: MockAPI, path: string, rows: unknown[]) {
  api.define("GET", path, ({ query }) => {
    const offset = Number(query.get("offset"));
    const limit = Number(query.get("limit"));
    return { json: { data: rows.slice(offset, offset + limit), total: rows.length } };
  }, query => {
    expect([...query.keys()].sort()).toEqual(["limit", "offset"]);
    const limit = Number(query.get("limit"));
    const offset = Number(query.get("offset"));
    expect([10, 20, 50, 100]).toContain(limit);
    expect(Number.isSafeInteger(offset) && offset >= 0 && offset % limit === 0).toBe(true);
  });
}

function checkout(api: MockAPI) {
  api.respond("GET", "/api/admin/wallet", { balance_micros: 1000000, available_micros: 1000000 });
  api.respond("GET", "/api/admin/recharge/plans", { data: [{ id: "one", amount_fen: 100 }], channels: ["alipay"] });
}

function costDetails(api: MockAPI) {
  api.respond("GET", "/api/admin/wallet", { balance_micros: 1000000, available_micros: 1000000 });
  api.define("GET", "/api/admin/usage/report", () => ({ json: usageReport("30d") }), query => expect(Object.fromEntries(query)).toEqual({ range: "30d" }));
}

for (const count of [0, 3]) {
  test(`cost history tabs keep headers and pagination visible with ${count} records`, async ({ page, api }, info) => {
    costDetails(api);
    history(api, "/api/admin/recharge/orders", orders(count));
    history(api, "/api/admin/wallet/usage", consumption(count));
    await page.goto("/billing/");
    await expect(page.getByRole("tab", { name: "充值记录", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(api.calls.some(call => call.path === "/api/admin/wallet/usage")).toBe(false);
    for (const name of ["充值记录", "消费流水"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      const panel = page.getByRole("tabpanel", { name, exact: true });
      await expect(panel.locator(".payment-history-table")).toHaveAttribute("aria-busy", "false");
      await expect(panel.getByRole("table", { name, exact: true })).toBeVisible();
      await expect(panel.locator("thead th")).toHaveCount(name === "充值记录" ? 4 : 5);
      await expect(panel.locator(".pagination")).toBeVisible();
      expect(await panel.locator(".pagination").evaluate(element =>
        Math.abs(element.getBoundingClientRect().width - element.parentElement!.getBoundingClientRect().width) < 1,
      )).toBe(true);
      await expect(panel.getByRole("combobox", { name: "每页", exact: true })).toHaveValue("10");
      await expect(panel.getByRole("button", { name: "上一页", exact: true })).toBeDisabled();
      await expect(panel.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
      await expect(panel.locator(".pagination-summary")).toHaveText(count === 0 ? "第 0-0 条，共 0 条" : "第 1-3 条，共 3 条");
    }
    const usageTab = page.getByRole("tab", { name: "消费流水", exact: true });
    await usageTab.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "充值记录", exact: true })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "充值记录", exact: true })).toBeVisible();
    await page.keyboard.press("End");
    await expect(usageTab).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "消费流水", exact: true })).toBeVisible();
    const section = page.locator(".cost-history");
    await section.scrollIntoViewIfNeeded();
    await capture(page, info, section, `cost-history-tabs-${count}`, "费用明细的充值记录与消费流水标签页", "viewport");
    await page.setViewportSize({ width: 390, height: 844 });
    const activePanel = page.getByRole("tabpanel", { name: "消费流水", exact: true });
    await activePanel.locator(".pagination").scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(activePanel.getByRole("button", { name: "最后一页", exact: true })).toBeInViewport();
    await capture(page, info, section, `cost-history-tabs-${count}-mobile`, "手机端消费流水与分页", "viewport");
  });
}

test("cost history tabs preserve independent pages and page sizes", async ({ page, api }, info) => {
  costDetails(api);
  history(api, "/api/admin/recharge/orders", orders(73));
  history(api, "/api/admin/wallet/usage", consumption(47));
  await page.goto("/billing/");
  const orderPanel = page.getByRole("tabpanel", { name: "充值记录", exact: true });
  const usagePanel = page.getByRole("tabpanel", { name: "消费流水", exact: true });
  await expect(orderPanel.locator("tbody tr")).toHaveCount(10);
  await orderPanel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(orderPanel.locator(".pagination-summary")).toHaveText("第 11-20 条，共 73 条");
  await page.getByRole("tab", { name: "消费流水", exact: true }).click();
  await expect(usagePanel.locator("tbody tr")).toHaveCount(10);
  await expect(usagePanel.getByText("history-request-0", { exact: true })).toBeVisible();
  await usagePanel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(usagePanel.getByText("history-request-10", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "充值记录", exact: true }).click();
  await expect(orderPanel.locator(".pagination-summary")).toHaveText("第 11-20 条，共 73 条");
  await orderPanel.getByRole("button", { name: "最后一页", exact: true }).click();
  await expect(orderPanel.locator("tbody tr")).toHaveCount(3);
  await orderPanel.getByRole("combobox", { name: "每页", exact: true }).selectOption("20");
  await expect(orderPanel.locator("tbody tr")).toHaveCount(20);
  await expect(orderPanel.locator(".pagination-summary")).toHaveText("第 1-20 条，共 73 条");
  await page.getByRole("tab", { name: "消费流水", exact: true }).click();
  await expect(usagePanel.getByText("history-request-10", { exact: true })).toBeVisible();
  await expect(usagePanel.getByRole("combobox", { name: "每页", exact: true })).toHaveValue("10");
  await usagePanel.getByRole("button", { name: "最后一页", exact: true }).click();
  await expect(usagePanel.locator("tbody tr")).toHaveCount(7);
  await expect(usagePanel.getByText("history-request-46", { exact: true })).toBeVisible();
  await expect(usagePanel.locator("thead th").first()).toHaveCSS("padding", "14px 16px");
  for (const offset of ["0", "10", "70"]) {
    expect(api.calls.some(call => call.path === "/api/admin/recharge/orders" && call.query.get("offset") === offset)).toBe(true);
  }
  await usagePanel.locator(".pagination").scrollIntoViewIfNeeded();
  await capture(page, info, usagePanel, "cost-usage-last-page", "消费流水独立保留页码", "viewport");
  await page.getByRole("button", { name: "切换到深色模式", exact: true }).click();
  await capture(page, info, usagePanel, "cost-usage-last-page-dark", "深色模式消费流水标签页", "viewport");
});

test("recharge page shows orders and leaves consumption history in cost details", async ({ page, api }) => {
  checkout(api);
  history(api, "/api/admin/recharge/orders", orders(23));
  await page.goto("/balance-recharge/");
  const section = page.getByRole("region", { name: "充值订单", exact: true });
  await expect(section.locator("tbody tr")).toHaveCount(10);
  await section.getByRole("button", { name: "最后一页", exact: true }).click();
  await expect(section.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("table", { name: "消费流水", exact: true })).toHaveCount(0);
  expect(api.calls.some(call => call.path === "/api/admin/wallet/usage")).toBe(false);
});

test("cost detail recharge history uses the shared server pagination", async ({ page, api }, info) => {
  costDetails(api);
  history(api, "/api/admin/recharge/orders", orders(67));
  await page.goto("/billing/");
  const table = page.getByRole("table", { name: "充值记录", exact: true });
  const panel = page.getByRole("tabpanel", { name: "充值记录", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(10);
  await expect(table.locator("thead th").first()).toHaveCSS("padding", "14px 16px");
  await expect(table.locator("tbody td").first()).toHaveCSS("font-size", "13px");
  await expect(panel.getByRole("combobox", { name: "每页", exact: true })).toHaveValue("10");
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(panel.locator(".pagination-summary")).toHaveText("第 11-20 条，共 67 条");
  await expect(table.getByText("¥1.10", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "最后一页", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(7);
  await panel.getByRole("combobox", { name: "每页", exact: true }).selectOption("50");
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(panel.locator(".pagination-summary")).toHaveText("第 1-50 条，共 67 条");
  await panel.locator(".pagination").scrollIntoViewIfNeeded();
  await capture(page, info, panel, "cost-history-pagination", "费用明细充值记录分页", "viewport");
});

test("cost history isolates usage errors and refreshes the active tab", async ({ page, api }) => {
  costDetails(api);
  history(api, "/api/admin/recharge/orders", orders(2));
  let failed = true;
  api.define("GET", "/api/admin/wallet/usage", () => failed
    ? { status: 503, json: { error: { message: "Synthetic usage history unavailable" } } }
    : { json: { data: consumption(3), total: 3 } },
  query => expect(Object.fromEntries(query)).toEqual({ limit: "10", offset: "0" }));
  await page.goto("/billing/");
  await expect(page.getByRole("tabpanel", { name: "充值记录", exact: true }).locator("tbody tr")).toHaveCount(2);
  await page.getByRole("tab", { name: "消费流水", exact: true }).click();
  await expect(page.locator(".cost-history").getByRole("alert")).toHaveText("Synthetic usage history unavailable (HTTP 503)");
  await page.getByRole("tab", { name: "充值记录", exact: true }).click();
  await expect(page.locator(".cost-history").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("tabpanel", { name: "充值记录", exact: true }).locator("tbody tr")).toHaveCount(2);
  await page.getByRole("tab", { name: "消费流水", exact: true }).click();
  await expect(page.locator(".cost-history").getByRole("alert")).toHaveText("Synthetic usage history unavailable (HTTP 503)");
  failed = false;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "消费流水", exact: true });
  await expect(panel.locator("tbody tr")).toHaveCount(3);
  await expect(page.locator(".cost-history").getByRole("alert")).toHaveCount(0);
  await expect(panel.locator(".pagination-summary")).toHaveText("第 1-3 条，共 3 条");
});
