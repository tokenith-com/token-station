import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConsumerRechargeView } from "../views/recharge";
import { BalanceCard } from "./balance-card";

it("uses the prepaid wallet in checkout and the top bar without a simulated entry", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/recharge/plans")) return Response.json({ data: [{ id: "plan", amount_fen: 100 }], channels: ["alipay"] });
    if (url.endsWith("/wallet")) return Response.json({ balance_micros: 12500000, available_micros: 12500000 });
    if (url.includes("/wallet/usage?") || url.includes("/recharge/orders?")) return Response.json({ data: [] });
    throw new Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", fetch);
  const api = { baseURL: "http://example.test", adminToken: "synthetic-session" };
  render(<><ConsumerRechargeView api={api} /><BalanceCard api={api} activeView="balance-recharge" onSelectView={() => {}} /></>);
  expect(await screen.findByRole("button", { name: "创建充值订单" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "账户余额充值" })).not.toBeInTheDocument();
  expect(screen.getAllByText("暂无数据").length).toBeGreaterThan(0);
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
    if (url.includes("/wallet/usage?") || url.includes("/recharge/orders?")) return Response.json({ data: [] });
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

it("retries a transient polling failure and removes payment controls after settlement", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/recharge/plans")) return Response.json({ data: [{ id: "plan", amount_fen: 100 }], channels: ["wechat", "alipay"] });
    if (url.endsWith("/wallet")) return Response.json({ balance_micros: 1000000, available_micros: 1000000 });
    if (url.endsWith("/recharge/orders") && init?.method === "POST") return Response.json({ order_no: "poll", status: "pending", channel: "wechat", amount_fen: 100, qr_code: "weixin://fixture" });
    if (url.endsWith("/recharge/orders/poll")) {
      if (++reads === 1) throw new Error("Temporary connection failure");
      return Response.json({ order_no: "poll", status: "succeeded", channel: "wechat", amount_fen: 100 });
    }
    if (url.includes("/wallet/usage?") || url.includes("/recharge/orders?")) return Response.json({ data: [] });
    throw new Error("Unexpected request: " + url);
  }));
  render(<ConsumerRechargeView api={{ baseURL: "http://example.test", adminToken: "synthetic-session" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "创建充值订单" }));
  await screen.findByRole("button", { name: "刷新订单状态" });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("充值已到账"), { timeout: 8000 });
  expect(reads).toBe(2);
  expect(screen.queryByRole("button", { name: "刷新订单状态" })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续充值" })).toBeEnabled();
}, 10000);

it("does not trust a returned status or display an inaccessible order as paid", async () => {
  window.history.replaceState(null, "", "/balance-recharge/?payment_order=foreign&status=succeeded");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/recharge/plans")) return Response.json({ data: [], channels: [] });
    if (url.endsWith("/wallet")) return Response.json({ balance_micros: 0, available_micros: 0 });
    if (url.endsWith("/recharge/orders/foreign")) return Response.json({ error: { message: "Order not found" } }, { status: 404 });
    if (url.includes("/wallet/usage?") || url.includes("/recharge/orders?")) return Response.json({ data: [] });
    throw new Error("Unexpected request: " + url);
  }));
  try {
    render(<ConsumerRechargeView api={{ baseURL: "http://example.test", adminToken: "synthetic-session" }} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("充值已到账")).not.toBeInTheDocument();
  } finally { window.history.replaceState(null, "", "/"); }
});
