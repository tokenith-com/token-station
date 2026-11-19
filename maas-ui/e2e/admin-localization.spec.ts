import { login } from "./session";
import { expect, test } from "@playwright/test";

test("built-in plugin cards follow the console language without reloading", async ({ page }) => {
  await login(page);
  const card = page.getByRole("article").filter({ hasText: "tokenhub.admin.plugin-ecosystem" });
  await expect(card.getByRole("heading", { name: "插件生态", exact: true })).toBeVisible();
  await expect(card.getByText("已注册插件", { exact: true })).toBeVisible();
  for (const [option, title, label] of [
    ["English", "Plugin Ecosystem", "Registered plugins"],
    ["日本語", "プラグインエコシステム", "登録済みプラグイン"],
    ["简体中文", "插件生态", "已注册插件"],
  ]) {
    await page.locator(".language-select-trigger").click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await expect(card.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await card.screenshot({ path: test.info().outputPath("plugin-localization-mobile.png") });
});
