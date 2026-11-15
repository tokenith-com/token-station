import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { BalanceRechargeView } from "./balance-recharge";
import type { ApiContext } from "../core/types";
import { uniqueUIID } from "../domain/formatting";
import { tx } from "../i18n/runtime";
import { formatWalletMicros, walletRequest, type Wallet } from "../resources/wallet";

type Order = { order_no: string; status: string; qr_code?: string; pay_url?: string };
type Plans = { data: { id: string; name: string; amount_fen: number }[]; channels: string[] };
type Usage = { request_id: string; model: string; status: string; charged_micros: number };
type CheckoutAttempt = { plan_id: string; channel: string; key: string };

function checkoutURL(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function ConsumerRechargeView({ api }: { api: ApiContext }) {
  const [mode, setMode] = useState<"payment" | "consumer">("consumer");
  return <>
    <div className="toolbar consumer-recharge-tabs" role="group" aria-label={tx("充值方式")}>
      <button className={mode === "consumer" ? "button" : "secondary-button"} type="button" aria-pressed={mode === "consumer"} onClick={() => setMode("consumer")}>{tx("账户余额充值")}</button>
      <button className={mode === "payment" ? "button" : "secondary-button"} type="button" aria-pressed={mode === "payment"} onClick={() => setMode("payment")}>{tx("在线支付充值")}</button>
    </div>
    {mode === "payment" ? <RechargeView api={api} /> : <BalanceRechargeView api={api} />}
  </>;
}

export function RechargeView({ api }: { api: ApiContext }) {
  const [plans, setPlans] = useState<Plans>();
  const [wallet, setWallet] = useState<Wallet>();
  const [usage, setUsage] = useState<Usage[]>([]);
  const [attempt, setAttempt] = useState<CheckoutAttempt>();
  const [order, setOrder] = useState<Order>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [plan, setPlan] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { baseURL, adminToken } = api;

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const context = { baseURL, adminToken };
    void Promise.all([
      walletRequest<Plans>(context, "/api/admin/recharge/plans", options),
      walletRequest<Wallet>(context, "/api/admin/wallet", options),
      walletRequest<{ data: Usage[] }>(context, "/api/admin/wallet/usage", options),
      walletRequest<{ data: Order[] }>(context, "/api/admin/recharge/orders", options),
    ]).then(([options, balance, history, checkoutHistory]) => {
      setPlans(options);
      setPlan(options.data[0]?.id ?? "");
      setChannel(options.channels[0] ?? "");
      setWallet(balance);
      setUsage(history.data);
      setOrders(checkoutHistory.data);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(String(err instanceof Error ? err.message : err));
    });
    return () => controller.abort();
  }, [baseURL, adminToken]);

  async function createOrder() {
    const current = attempt ?? { plan_id: plan, channel, key: uniqueUIID("recharge") };
    setAttempt(current);
    setBusy(true);
    setError("");
    try {
      const next = await walletRequest<Order>(api, "/api/admin/recharge/orders", {
        method: "POST", headers: { "Idempotency-Key": current.key },
        body: JSON.stringify({ plan_id: current.plan_id, channel: current.channel }),
      });
      setOrder(next);
      setOrders((current) => [next, ...current.filter((item) => item.order_no !== next.order_no)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("请求失败"));
    } finally {
      setBusy(false);
    }
  }

  async function refreshOrder(selected: Order) {
    setBusy(true);
    setError("");
    try {
      const next = await walletRequest<Order>(api, `/api/admin/recharge/orders/${encodeURIComponent(selected.order_no)}`);
      setOrder(next);
      setOrders((current) => current.map((item) => item.order_no === next.order_no ? next : item));
      setWallet(await walletRequest<Wallet>(api, "/api/admin/wallet"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("请求失败"));
    } finally {
      setBusy(false);
    }
  }

  const payURL = checkoutURL(order?.pay_url);
  const statusLabel = (status: string) => {
    switch (status) {
      case "pending": return tx("待支付");
      case "succeeded": return tx("充值已到账");
      case "closed": return tx("订单已关闭");
      case "refunded": return tx("已退款");
      case "refund_pending": return tx("退款处理中");
      default: return tx("订单状态待确认");
    }
  };
  return (
    <section className="guest-cost-view">
      <header className="guest-cost-heading"><h1>{tx("余额充值")}</h1></header>
      {wallet && <p>{tx("可用余额")} {formatWalletMicros(wallet.available_micros)}
        {wallet.balance_micros > wallet.available_micros && <> · {tx("冻结金额")} {formatWalletMicros(wallet.balance_micros - wallet.available_micros)}</>}
      </p>}
      {error && <p role="alert">{error}</p>}
      {plans && (
        <section className="section">
          <form className="toolbar" onSubmit={(event) => { event.preventDefault(); void createOrder(); }}>
            <label>{tx("充值金额")} <select value={plan} disabled={busy || Boolean(attempt) || Boolean(order)} onChange={(event) => setPlan(event.target.value)}>
              {plans.data.map((item) => <option key={item.id} value={item.id}>{formatWalletMicros(item.amount_fen * 10_000)}</option>)}
            </select></label>
            <label>{tx("支付方式")} <select value={channel} disabled={busy || Boolean(attempt) || Boolean(order)} onChange={(event) => setChannel(event.target.value)}>
              {plans.channels.map((item) => <option key={item} value={item}>{item === "wechat" ? tx("微信支付") : tx("支付宝")}</option>)}
            </select></label>
            {(!order || order.status === "pending" && !order.qr_code && !payURL) && <button className="button" disabled={busy || !plan || !channel}>{tx("创建充值订单")}</button>}
          </form>
          {order && <div>
            <p>{tx("订单号")} {order.order_no}</p>
            {order.status === "pending" && order.qr_code && <QRCodeCanvas value={order.qr_code} size={200} marginSize={4} title={tx("支付二维码")} />}
            {order.status === "pending" && payURL && <a href={payURL} target="_blank" rel="noopener noreferrer">{tx("打开支付宝收银台")}</a>}
            <p role="status">{statusLabel(order.status)}</p>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void refreshOrder(order)}>{tx("刷新订单状态")}</button>
          </div>}
          {(attempt || order) && !busy && <button type="button" className="secondary-button" onClick={() => { setAttempt(undefined); setOrder(undefined); setError(""); }}>{tx("新建充值订单")}</button>}
        </section>
      )}
      {orders.length > 0 && <section className="section">
        <h2>{tx("充值订单")}</h2>
        <ul>{orders.map((item) => <li key={item.order_no}>
          <button type="button" className="text-button" disabled={busy} onClick={() => void refreshOrder(item)}>{item.order_no}</button> · {statusLabel(item.status)}
        </li>)}</ul>
      </section>}
      {usage.length > 0 && <section className="section">
        <h2>{tx("消费流水")}</h2>
        <ul>{usage.map((entry) => <li key={entry.request_id}>{entry.model} · {entry.request_id} · {entry.status === "settled" ? formatWalletMicros(entry.charged_micros) : entry.status === "released" ? tx("未扣费") : tx("待结算")}</li>)}</ul>
      </section>}
    </section>
  );
}
