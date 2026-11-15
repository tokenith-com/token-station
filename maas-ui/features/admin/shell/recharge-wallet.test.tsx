import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConsumerRechargeView } from "../views/recharge";
import { BalanceCard } from "./balance-card";

it("uses the prepaid wallet in checkout and the top bar without a simulated entry", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/recharge/plans")) return Response.json({ data: [{ id: "plan", amount_fen: 100 }], channels: ["alipay"] });
    if (url.endsWith("/wallet")) return Response.json({ balance_micros: 12500000, available_micros: 12500000 });
    if (url.endsWith("/wallet/usage") || url.endsWith("/recharge/orders")) return Response.json({ data: [] });
    throw new Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", fetch);
  const api = { baseURL: "http://example.test", adminToken: "synthetic-session" };
  render(<><ConsumerRechargeView api={api} /><BalanceCard api={api} activeView="balance-recharge" onSelectView={() => {}} /></>);
  expect(await screen.findByRole("button", { name: "创建充值订单" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "账户余额充值" })).not.toBeInTheDocument();
  expect(screen.getByText("暂无数据")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /账户余额.*12.50/ })).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.includes("/consumer/"))).toBe(false);
});
