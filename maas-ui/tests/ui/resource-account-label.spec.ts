import { capture, expect, test } from "./harness";
import { installUsageFixtures, usageReport } from "./fixtures/global-usage";

test("resource-account usage explains unassigned records in Chinese", async ({ page, api }, info) => {
  installUsageFixtures(api, range => {
    const report = usageReport(range);
    report.breakdown.provider_resources = [{ id: "unknown", request_count: 4, input_tokens: 6000, output_tokens: 1109, total_tokens: 7109, estimated_cost_usd: 0.0103974 }];
    return { json: report };
  });
  await page.goto("/usage/");
  const section = page.locator("section.section").filter({ has: page.getByRole("heading", { name: "资源账号用量", exact: true }) });
  await expect(section.getByRole("cell", { name: "未关联资源账号", exact: true })).toBeVisible();
  await expect(section.getByText("未关联资源账号：包含使用供应商直接凭证或未记录资源账号归属的用量。", { exact: true })).toBeVisible();
  await expect(section.getByRole("cell", { name: "unknown", exact: true })).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  await capture(page, info, section, "resource-account-unassigned", "资源账号用量：未关联说明");
});
