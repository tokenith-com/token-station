import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BillingWorkspace } from "../legacy-source/views/billing-workspace";
import { setActiveLanguage } from "../i18n/runtime";
import { setActiveLanguage as setSourceLanguage } from "../legacy-source/i18n/runtime";

const api = { baseURL: "https://fixture.invalid", adminToken: "synthetic" };
beforeEach(() => {
  setActiveLanguage("zh-CN"); setSourceLanguage("zh-CN");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/recharge/settings")) return Response.json({ plans: [{ id: "ten", name: "Ten", amount_fen: 1000 }], custom_enabled: true, min_fen: 1, max_fen: 500000 });
    if (url.endsWith("/projects") || url.endsWith("/payment-orders") || url.includes("/payment-wallet/usage?")) return Response.json({ data: [] });
    throw new Error("Undeclared request: " + url);
  }));
});

it("preserves unsaved recharge edits while switching billing tabs", async () => {
  render(<BillingWorkspace api={api} role="admin"><div>Management fixture</div></BillingWorkspace>);
  fireEvent.click(screen.getByRole("tab", { name: "充值设置" }));
  fireEvent.change(await screen.findByLabelText("档位名称"), { target: { value: "Edited draft" } });
  fireEvent.click(screen.getByRole("tab", { name: "支付与钱包对账" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  fireEvent.click(screen.getByRole("tab", { name: "充值设置" }));
  expect(screen.getByLabelText("档位名称")).toHaveValue("Edited draft");
  expect(screen.getByRole("tab", { name: "充值设置" })).toHaveAttribute("aria-selected", "true");
});

it("shows recharge settings to platform administrators", async () => {
  render(<BillingWorkspace api={api} role="admin"><div>Management fixture</div></BillingWorkspace>);
  expect(screen.getByRole("tab", { name: "充值设置" })).toBeInTheDocument();
});

it("keeps recharge settings unavailable to ordinary administrators", async () => {
  render(<BillingWorkspace api={api} role="team_leader"><div>Management fixture</div></BillingWorkspace>);
  expect(screen.queryByRole("tab", { name: "充值设置" })).not.toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("recharge/settings"))).toBe(false);
});
