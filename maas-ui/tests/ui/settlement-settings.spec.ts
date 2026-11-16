import { test, expect, capture } from "./harness";
import type { TeamWalletExchangeRate } from "../../features/admin/core/usage-report-types";

const ratePath = "/api/admin/team-wallet/exchange-rate";
const historyPath = `${ratePath}/history`;
const historyEntry = { id: "history-synthetic", usd_to_cny: "999999999999999999.123456", created_at: "2026-01-02T03:04:05Z", actor_user_id: "synthetic-admin", actor_name: "SyntheticSettlementAdministrator".repeat(4) };
const validateHistoryQuery = (query: URLSearchParams) => {
  expect([...query.keys()].sort()).toEqual(["limit", "offset"]);
  expect(query.get("limit")).toBe("50");
  expect(["0", "50"]).toContain(query.get("offset"));
};
const unconfigured: TeamWalletExchangeRate = { usd_to_cny: "", configured: false, paid_calls_enabled: false };

test.describe("settlement-settings configuration", () => {
  test.beforeEach(async ({ api }) => {
    api.define("GET", historyPath, () => ({ json: { entries: [], total: 0, limit: 50, offset: 0 } }), validateHistoryQuery);
  });
  for (const mobile of [false, true]) {
    test(`settlement-settings ${mobile ? "mobile dark" : "desktop"} saves an exact decimal rate`, async ({ context, page, api }, info) => {
      if (mobile) {
        await page.setViewportSize({ width: 390, height: 844 });
        await context.addInitScript(() => localStorage.setItem("tokenhub.theme", "dark"));
      }
      let rate = structuredClone(unconfigured);
      api.define("GET", ratePath, () => ({ json: rate }));
      api.define("PUT", ratePath, call => {
        expect(call.body).toEqual({ usd_to_cny: "7.123456" });
        rate = { usd_to_cny: "7.123456", configured: true, paid_calls_enabled: true };
        return { json: rate };
      });
      await page.goto("/settlement-settings");
      const panel = page.locator(".settlement-settings");
      const input = panel.getByRole("textbox", { name: "美元兑人民币汇率", exact: true });
      const save = panel.getByRole("button", { name: "保存配置", exact: true });
      await expect(input).toHaveValue("");
      await expect(save).toBeDisabled();
      await expect(panel.getByText("汇率未配置", { exact: true })).toBeVisible();
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const rules = panel.locator(".settlement-rules-body");
      const note = await rules.getByRole("note").boundingBox();
      const footnote = await rules.locator(".settlement-rules-footnote").boundingBox();
      expect(footnote!.y - (note!.y + note!.height)).toBeGreaterThanOrEqual(16);
      const icon = await rules.locator("svg").boundingBox();
      const text = await rules.getByRole("note").locator("span").boundingBox();
      expect(text!.x).toBeGreaterThan(icon!.x + icon!.width);
      expect(Math.abs(text!.y - icon!.y)).toBeLessThanOrEqual(4);
      await capture(page, info, panel, `settlement-settings-${mobile ? "mobile" : "desktop"}`, "结算配置：汇率与生效规则", "viewport");
      await input.fill("0");
      await expect(save).toBeDisabled();
      await input.fill("7.1234567");
      await expect(save).toBeDisabled();
      await input.fill("7.123456");
      await save.click();
      await expect(panel.getByText("汇率已配置", { exact: true })).toBeVisible();
      await expect(input).toHaveValue("7.123456");
      await expect(save).toBeDisabled();
      expect(api.calls.filter(call => call.method === "PUT")).toHaveLength(1);
      await page.reload();
      await expect(input).toHaveValue("7.123456");
    });
  }

  test("settlement-settings failure preserves input and permits retry", async ({ page, api }, info) => {
    api.respond("GET", ratePath, { usd_to_cny: "7.000001", configured: true, paid_calls_enabled: true } satisfies TeamWalletExchangeRate);
    let writes = 0;
    api.define("PUT", ratePath, call => {
      expect(call.body).toEqual({ usd_to_cny: "7.234567" });
      return ++writes === 1
        ? { status: 503, json: { error: "Synthetic settlement failure" } }
        : { json: { usd_to_cny: "7.234567", configured: true, paid_calls_enabled: true } };
    });
    await page.goto("/settlement-settings");
    const panel = page.locator(".settlement-settings");
    const input = panel.getByRole("textbox", { name: "美元兑人民币汇率", exact: true });
    const save = panel.getByRole("button", { name: "保存配置", exact: true });
    await expect(input).toHaveValue("7.000001");
    await input.fill("7.234567");
    await save.click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(input).toHaveValue("7.234567");
    await expect(save).toBeEnabled();
    await capture(page, info, panel, "settlement-settings-save-failure", "结算配置：保存失败保留输入", "viewport");
    await save.click();
    await expect(save).toBeDisabled();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect(writes).toBe(2);
  });

  test("settlement-settings loading failure can be retried", async ({ page, api }) => {
    let reads = 0;
    api.define("GET", ratePath, () => ++reads === 1
      ? { status: 503, json: { error: "Synthetic settlement read failure" } }
      : { json: unconfigured });
    await page.goto("/settlement-settings");
    const panel = page.locator(".settlement-settings");
    await expect(panel.getByRole("alert")).toBeVisible();
    await panel.getByRole("button", { name: "重试", exact: true }).click();
    await expect(panel.getByRole("textbox", { name: "美元兑人民币汇率", exact: true })).toHaveValue("");
    await expect(panel.getByText("汇率未配置", { exact: true })).toBeVisible();
    expect(reads).toBe(2);
  });
});

test.describe("settlement-settings history", () => {
  for (const mobile of [false, true]) {
    test(`settlement-settings history ${mobile ? "mobile" : "desktop"} paginates long content and refreshes after save`, async ({ page, api }, info) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      api.respond("GET", ratePath, { usd_to_cny: "7.2", configured: true, paid_calls_enabled: true } satisfies TeamWalletExchangeRate);
      let saved = false;
      api.define("GET", historyPath, call => {
        const offset = Number(call.query.get("offset"));
        return { json: { entries: [{ ...historyEntry, id: `history-${offset}`, actor_name: offset ? "Earlier synthetic operator" : historyEntry.actor_name, usd_to_cny: saved ? "8.123456" : historyEntry.usd_to_cny }], total: 51, limit: 50, offset } };
      }, validateHistoryQuery);
      api.define("PUT", ratePath, call => {
        expect(call.body).toEqual({ usd_to_cny: "8.123456" });
        saved = true;
        return { json: { usd_to_cny: "8.123456", configured: true, paid_calls_enabled: true } };
      });
      await page.goto("/settlement-settings");
      const history = page.getByRole("region", { name: "汇率保存历史", exact: true });
      await expect(history.getByText(`1 USD = ${historyEntry.usd_to_cny} CNY`, { exact: true })).toBeVisible();
      await expect(history.getByText(historyEntry.actor_name, { exact: true })).toBeVisible();
      await expect(history.locator("time")).toContainText(/UTC|GMT/);
      expect(await history.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await history.scrollIntoViewIfNeeded();
      await capture(page, info, history, `settlement-history-${mobile ? "mobile" : "desktop"}`, "汇率历史：长汇率、长姓名与分页", "viewport");
      await expect(history.getByRole("button", { name: "上一页" })).toBeDisabled();
      await history.getByRole("button", { name: "下一页" }).click();
      await expect(history.getByText("Earlier synthetic operator")).toBeVisible();
      await expect(history.getByRole("button", { name: "下一页" })).toBeDisabled();
      await page.getByRole("textbox", { name: "美元兑人民币汇率", exact: true }).fill("8.123456");
      await page.getByRole("button", { name: "保存配置", exact: true }).click();
      await expect(history.getByText("1 USD = 8.123456 CNY")).toBeVisible();
      await expect(history.getByRole("button", { name: "上一页" })).toBeDisabled();
      expect(api.calls.filter(call => call.path === historyPath).map(call => call.query.get("offset"))).toEqual(["0", "50", "0"]);
    });
  }

  test("settlement-settings history loading and retry stay independent from a successful save", async ({ page, api }, info) => {
    api.respond("GET", ratePath, unconfigured);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    api.define("GET", historyPath, async () => {
      if (++reads === 1) { await gate; return { json: { entries: [], total: 0, limit: 50, offset: 0 } }; }
      if (reads === 2) return { status: 503, json: { error: "Synthetic history refresh failure" } };
      return { json: { entries: [{ ...historyEntry, usd_to_cny: "7.123456" }], total: 1, limit: 50, offset: 0 } };
    }, validateHistoryQuery);
    api.define("PUT", ratePath, call => {
      expect(call.body).toEqual({ usd_to_cny: "7.123456" });
      return { json: { usd_to_cny: "7.123456", configured: true, paid_calls_enabled: true } };
    });
    await page.goto("/settlement-settings");
    const history = page.getByRole("region", { name: "汇率保存历史", exact: true });
    const input = page.getByRole("textbox", { name: "美元兑人民币汇率", exact: true });
    await expect(input).toBeEnabled();
    await expect(history).toHaveAttribute("aria-busy", "true");
    await input.fill("7.123456");
    release();
    await expect(history.getByText("暂无汇率保存记录")).toBeVisible();
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(page.getByText("结算汇率已保存", { exact: true })).toBeVisible();
    await expect(history.getByRole("alert")).toContainText("汇率保存历史加载失败");
    await expect(input).toHaveValue("7.123456");
    await history.scrollIntoViewIfNeeded();
    await capture(page, info, history, "settlement-history-refresh-failure", "汇率历史：保存成功但历史刷新失败", "viewport");
    await history.getByRole("button", { name: "重试", exact: true }).click();
    await expect(history.getByText("1 USD = 7.123456 CNY")).toBeVisible();
    await expect(page.getByText("结算汇率已保存", { exact: true })).toBeVisible();
  });
});
