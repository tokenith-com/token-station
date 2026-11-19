import { expect, test } from "@playwright/test";
import e2eDefaults from "./config.cjs";

const backendURL = `http://127.0.0.1:${process.env.TOKENHUB_E2E_BACKEND_PORT ?? e2eDefaults.backendPort}`;

test("super admin credits a team wallet once and reads its exact USD ledger", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "账号", exact: true }).fill(e2eDefaults.adminIdentity);
  await page.getByLabel("密码", { exact: true }).fill(process.env.TOKENHUB_E2E_ADMIN_PASSWORD ?? e2eDefaults.adminPassword);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem("tokenhub.admin.session.b")!));
  const headers = { authorization: `Bearer ${session.token}` };
  const created = await request.post(`${backendURL}/api/admin/resources/teams`, {
    headers, data: { name: "Synthetic E2E Wallet Team", status: "active", fields: { owner: session.user.id } },
  });
  expect(created.ok()).toBe(true);
  const team = await created.json();
  const walletPath = `${backendURL}/api/admin/teams/${team.id}/wallet`;
  const initial = await request.get(walletPath, { headers });
  expect(initial.ok()).toBe(true);
  expect(await initial.json()).toMatchObject({ currency: "USD", wallet: { team_id: team.id, balance_micros: 0 } });
  await page.goto("/teams");
  const row = page.getByRole("row").filter({ hasText: team.name });
  await row.getByRole("button", { name: "入账", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "确认入账", exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox", { name: "入账金额（USD）", exact: true }).fill("25.50");
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox", { name: "备注（必填，最多1000字）", exact: true }).fill("Synthetic E2E offline receipt");
  await expect(submit).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();
  const credited = page.waitForResponse(response => response.url() === `${walletPath}/credits` && response.request().method() === "POST");
  await submit.click();
  const creditResponse = await credited;
  expect(creditResponse.ok()).toBe(true);
  const payload = creditResponse.request().postDataJSON();
  expect(payload).toMatchObject({ amount_micros: 25_500_000, credit_type: "offline_receipt", remark: "Synthetic E2E offline receipt", request_id: expect.any(String) });
  const credit = await creditResponse.json();
  expect(credit).toMatchObject({ currency: "USD", entry: { before_balance_micros: 0, after_balance_micros: 25_500_000 } });
  await expect(dialog).toHaveCount(0);
  await row.getByRole("button", { name: "资金流水", exact: true }).click();
  const ledger = page.getByRole("dialog");
  await expect(ledger.getByText("Synthetic E2E offline receipt", { exact: true })).toBeVisible();
  await expect(ledger).toContainText("25.50");
  const replay = await request.post(`${walletPath}/credits`, { headers, data: payload });
  expect(replay.ok()).toBe(true);
  expect((await replay.json()).entry.id).toBe(credit.entry.id);
  const finalWallet = await request.get(walletPath, { headers });
  expect(finalWallet.ok()).toBe(true);
  expect(await finalWallet.json()).toMatchObject({ currency: "USD", wallet: { balance_micros: 25_500_000 } });
  const entries = await request.get(`${walletPath}/ledger?limit=20&offset=0`, { headers });
  expect(entries.ok()).toBe(true);
  expect(await entries.json()).toMatchObject({ currency: "USD", total: 1, entries: [{ id: credit.entry.id, amount_micros: 25_500_000, before_balance_micros: 0, after_balance_micros: 25_500_000 }] });
});
