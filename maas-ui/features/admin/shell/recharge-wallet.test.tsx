import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("opens Alipay from the user gesture and navigates after checkout resolves", async () => {
  const replace = vi.fn();
  const close = vi.fn();
  const tab = { opener: {}, location: { replace }, close };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  let complete!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/recharge/plans")) return Response.json({ data: [{ id: "plan", amount_fen: 100 }], channels: ["alipay"] });
    if (url.endsWith("/wallet")) return Response.json({ balance_micros: 0, available_micros: 0 });
    if (url.endsWith("/recharge/orders") && init?.method === "POST") return new Promise<Response>(resolve => { complete = resolve; });
    if (url.endsWith("/wallet/usage") || url.endsWith("/recharge/orders")) return Response.json({ data: [] });
    throw new Error("Unexpected request: " + url);
  }));
  render(<ConsumerRechargeView api={{ baseURL: "http://example.test", adminToken: "synthetic-session" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "创建充值订单" }));
  expect(open).toHaveBeenCalledWith("about:blank", "_blank");
  expect(tab.opener).toBeNull();
  expect(replace).not.toHaveBeenCalled();
  complete(Response.json({ order_no: "checkout", status: "pending", pay_url: "https://openapi.alipay.com/gateway.do?test=synthetic" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("https://openapi.alipay.com/gateway.do?test=synthetic"));
  expect(await screen.findByRole("link", { name: "打开支付宝收银台" })).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  open.mockRestore();
});
