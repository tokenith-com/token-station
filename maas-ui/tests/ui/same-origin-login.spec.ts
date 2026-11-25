import { test, expect } from "@playwright/test";

// Run against a static build with NEXT_PUBLIC_TOKENHUB_API_BASE_URL=/.
test("same-origin-login: password login avoids the legacy proxy", async ({ page }) => {
  test.skip(process.env.TOKENHUB_UI_SAME_ORIGIN !== "1", "Requires the --same-origin static build.");
  const requests: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push(`${request.method()} ${url.pathname}`);
    if (request.method() === "GET" && url.pathname === "/api/admin/auth/identity-providers") return route.fulfill({ json: { data: [] } });
    if (request.method() === "POST" && url.pathname === "/api/admin/auth/login") {
      expect(request.postDataJSON()).toEqual({ identity: "same-origin@example.test", password: "SyntheticPassword123!" });
      return route.fulfill({ status: 401, json: { error: { code: "invalid_credentials", message: "Synthetic rejection" } } });
    }
    throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}`);
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "账号", exact: true }).fill("same-origin@example.test");
  await page.getByLabel("密码", { exact: true }).fill("SyntheticPassword123!");
  await page.locator(".tc-login-form").getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".tc-login-card").getByRole("alert")).toContainText("401");
  expect(requests).toContain("POST /api/admin/auth/login");
  expect(requests.some(path => path.includes("/api/backend/"))).toBe(false);
});
