import { capture, expect, test } from "./harness";
import { installUsageFixtures, usageReport } from "./fixtures/global-usage";

for (const mobile of [false, true]) {
 test(`department-token comparison ${mobile ? "mobile" : "desktop"}`, async ({ page, api }, info) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  installUsageFixtures(api, range => {
    const report = usageReport(range);
    report.breakdown.projects = [
      { id: "Research and Development", request_count: 120, input_tokens: 7200000, output_tokens: 1600000, total_tokens: 8800000, estimated_cost_usd: 3 },
      { id: "Customer Success", request_count: 90, input_tokens: 4100000, output_tokens: 900000, total_tokens: 5000000, estimated_cost_usd: 2 },
      { id: "Platform Operations", request_count: 70, input_tokens: 2200000, output_tokens: 550000, total_tokens: 2750000, estimated_cost_usd: 1 },
      { id: "Product Design", request_count: 30, input_tokens: 600000, output_tokens: 380000, total_tokens: 980000, estimated_cost_usd: 0.5 },
    ];
    return { json: report };
  });
  await page.goto("/usage/");
  if (!mobile) {
    await expect(page.locator(".sidebar").getByRole("button", { name: "客户团队", exact: true })).toBeVisible();
    await expect(page.locator(".sidebar").getByRole("button", { name: "客户项目", exact: true })).toBeVisible();
  }
  await expect(page.getByText("客户团队与成员报告", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "客户团队 Token 消耗对比", exact: true })).toBeVisible();
  const chart = page.locator(".department-token-chart");
  await expect(chart.getByRole("listitem")).toHaveCount(4);
  const mark = chart.locator(".department-token-marks").first();
  await mark.focus();
  await expect(chart.getByRole("tooltip")).toContainText("7,200,000");
  await mark.blur();
  await expect(chart.locator("details")).toHaveAttribute("open", "");
  await expect(chart.getByRole("table")).toContainText("Research and Development");
  await chart.getByText("查看数据表", { exact: true }).click();
  await expect(chart.getByRole("table")).not.toBeVisible();
  await chart.getByText("查看数据表", { exact: true }).click();
  await chart.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, info, chart, `department-token-${mobile ? "mobile" : "desktop"}`, "部门 Token 对比：横向双条与完整名称", "viewport");
 });
}
