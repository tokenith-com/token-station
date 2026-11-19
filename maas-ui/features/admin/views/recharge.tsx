import { useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { Check, CreditCard, ListChecks, QrCode, WalletCards } from "lucide-react";

import type { ApiContext } from "../core/types";
import { uniqueUIID } from "../domain/formatting";
import { languageLocale, tx } from "../i18n/runtime";
import { formatWalletMicros, walletRequest, type Wallet } from "../resources/wallet";

import { usePaymentHistory, type PaymentOrder as Order } from "../resources/payment-history";
import { PaymentHistoryTable } from "../shared/payment-history-table";
type Plans = { custom_enabled?: boolean; min_fen?: number; max_fen?: number; data: { id: string; name: string; amount_fen: number }[]; channels: string[] };
type CheckoutAttempt = { plan_id: string; amount_fen?: number; channel: string; key: string };

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
  return <RechargeView api={api} />;
}

export function RechargeView({ api }: { api: ApiContext }) {
  const [plans, setPlans] = useState<Plans>();
  const [wallet, setWallet] = useState<Wallet>();
  const [attempt, setAttempt] = useState<CheckoutAttempt>();
  const [order, setOrder] = useState<Order>();
  const orderHistory = usePaymentHistory<Order>(api, "/api/admin/recharge/orders");
  const { rows: orders, setRows: setOrders } = orderHistory;
  const [plan, setPlan] = useState("");
  const [custom, setCustom] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const { baseURL, adminToken } = api;

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const context = { baseURL, adminToken };
    void Promise.all([
      walletRequest<Plans>(context, "/api/admin/recharge/plans", options),
      walletRequest<Wallet>(context, "/api/admin/wallet", options),
    ]).then(([options, balance]) => {
      if (controller.signal.aborted) return;
      setPlans(options);
      setPlan(options.data[0]?.id ?? "");
      setChannel(options.channels[0] ?? "");
      setWallet(balance);
      const returnedOrder = new URLSearchParams(window.location.search).get("payment_order");
      if (returnedOrder) {
        return walletRequest<Order>(context, `/api/admin/recharge/orders/${encodeURIComponent(returnedOrder)}`, { signal: controller.signal }).then(async result => {
          const latestBalance = await walletRequest<Wallet>(context, "/api/admin/wallet", { signal: controller.signal });
          if (!controller.signal.aborted) {
            setOrder(result);
            setWallet(latestBalance);
            window.dispatchEvent(new Event("tokenstation-wallet-updated"));
          }
        });
      }
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(String(err instanceof Error ? err.message : err));
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [baseURL, adminToken]);

  const customFen = /^\d+(?:\.\d{1,2})?$/.test(custom) ? Math.round(Number(custom) * 100) : 0;
  const validAmount = Boolean(plan) || Boolean(plans?.custom_enabled && customFen >= (plans.min_fen ?? 1) && customFen <= (plans.max_fen ?? 0));

  async function createOrder() {
    if (!validAmount) return;
    // Reserve a tab during the click so async checkout is not popup-blocked.
    const checkoutTab = channel === "alipay" ? window.open("about:blank", "_blank") : null;
    if (checkoutTab) checkoutTab.opener = null;
    const current = attempt ?? { plan_id: plan, ...(plan ? {} : { amount_fen: customFen }), channel, key: uniqueUIID("recharge") };
    setAttempt(current);
    setBusy(true);
    setError("");
    try {
      const next = await walletRequest<Order>(api, "/api/admin/recharge/orders", {
        method: "POST", headers: { "Idempotency-Key": current.key },
        body: JSON.stringify({ plan_id: current.plan_id, channel: current.channel, ...(current.amount_fen === undefined ? {} : { amount_fen: current.amount_fen }) }),
      });
      const url = checkoutURL(next.pay_url);
      if (checkoutTab) {
        if (url && next.status === "pending") checkoutTab.location.replace(url);
        else checkoutTab.close();
      }
      setOrder(next);
      orderHistory.pagination.setPage(1);
      orderHistory.refresh();
    } catch (err) {
      checkoutTab?.close();
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
      window.dispatchEvent(new Event("tokenstation-wallet-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("请求失败"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!order || order.status !== "pending") return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const next = await walletRequest<Order>(api, `/api/admin/recharge/orders/${encodeURIComponent(order.order_no)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (next.status !== "pending") {
          const balance = await walletRequest<Wallet>(api, "/api/admin/wallet", { signal: controller.signal });
          if (controller.signal.aborted) return;
          setWallet(balance);
          window.dispatchEvent(new Event("tokenstation-wallet-updated"));
        }
        setError("");
        setOrder(next);
        setOrders(current => current.map(item => item.order_no === next.order_no ? next : item));
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : tx("请求失败"));
          timer = window.setTimeout(poll, 3000);
        }
      }
    };
    timer = window.setTimeout(poll, 3000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [api, order, setOrders]);

  function newOrder() {
    setAttempt(undefined); setOrder(undefined); setError("");
    const url = new URL(window.location.href);
    url.searchParams.delete("payment_order");
    window.history.replaceState(window.history.state, "", url);
  }
  const channelLabel = (value?: string) => value === "wechat" ? tx("微信支付") : value === "alipay" ? tx("支付宝") : "—";
  const amountLabel = (value?: number) => typeof value === "number" ? formatWalletMicros(value * 10000) : "—";

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
    <section className="guest-cost-view payment-workspace">
      <header className="guest-cost-heading payment-heading"><h1>{tx("余额充值")}</h1><p>{tx("为您的账户充值，享受更多服务")}</p></header>
      {orderHistory.error && <p className="recharge-alert error" role="alert">{orderHistory.error}</p>}
      {error && <p className="recharge-alert error" role="alert">{error}</p>}
      <div className="payment-checkout-layout">
      <div className="payment-checkout-main">
      <section className="payment-panel payment-balance-panel">
        <h2><WalletCards aria-hidden="true" />{tx("账户余额")}</h2>
        <div className="recharge-balance">
          <span>{tx("当前余额")}</span>
          <strong>{wallet ? formatWalletMicros(wallet.available_micros) : "—"}</strong>
          {wallet && wallet.balance_micros > wallet.available_micros && <small>{tx("冻结金额")} {formatWalletMicros(wallet.balance_micros - wallet.available_micros)}</small>}
        </div>
      </section>
      {plans && (
        <section className="payment-checkout">
          {!order && <form className="payment-form" onSubmit={(event) => { event.preventDefault(); void createOrder(); }}>
            <fieldset className="payment-amounts payment-panel" disabled={busy || Boolean(attempt) || Boolean(order)}>
              <legend><ListChecks aria-hidden="true" />{tx("选择充值规格")}</legend>
              <div className="payment-amount-options">
                {plans.data.map((item) => <button key={item.id} type="button" className="payment-amount-option" aria-pressed={plan === item.id} onClick={() => setPlan(item.id)}>{formatWalletMicros(item.amount_fen * 10_000)}</button>)}
                {plans.custom_enabled && <button type="button" className="payment-amount-option" aria-pressed={!plan} onClick={() => setPlan("")}>{tx("自定义金额")}</button>}
              </div>
            {!plan && plans.custom_enabled && <label className="payment-custom-amount">{tx("自定义金额")}<input aria-label={tx("自定义金额")} type="number" required min={(plans.min_fen ?? 1) / 100} max={(plans.max_fen ?? 0) / 100} step="0.01" value={custom} disabled={busy || Boolean(attempt) || Boolean(order)} onChange={event => setCustom(event.target.value)} /><small>{formatWalletMicros((plans.min_fen ?? 1) * 10000)} – {formatWalletMicros((plans.max_fen ?? 0) * 10000)}</small></label>}
            </fieldset>
            <fieldset className="payment-amounts payment-panel" disabled={busy || Boolean(attempt)}>
              <legend><CreditCard aria-hidden="true" />{tx("支付方式")}</legend>
              <div className="payment-channel-options">
                {plans.channels.map(item => <button key={item} type="button" className={`payment-channel-option ${item}`} aria-label={channelLabel(item)} aria-pressed={channel === item} onClick={() => setChannel(item)}>
                  <span className="payment-channel-radio" aria-hidden="true" />
                  <span className="payment-channel-mark" aria-hidden="true">{item === "alipay" ? "支" : <><i /><i /></>}</span>
                  <span className="payment-channel-copy"><strong>{channelLabel(item)}</strong><small>{item === "alipay" ? tx("推荐使用，到账快速") : tx("微信扫码支付")}</small></span>
                </button>)}
              </div>
            </fieldset>
            <footer className="recharge-summary">
              <div><span>{tx("本次充值金额")}</span><strong>{amountLabel(plan ? plans.data.find(item => item.id === plan)?.amount_fen : validAmount ? customFen : 0)}</strong></div>
              <button className="button" disabled={busy || !validAmount || !channel}><QrCode size={16} aria-hidden="true" />{tx("创建充值订单")}</button>
            </footer>
          </form>}
          {order && <div className="payment-result">
            <p role="status" className="payment-result-status">{statusLabel(order.status)}</p>
            <strong className="payment-result-amount">{amountLabel(order.amount_fen)}</strong>
            <p className="payment-order-detail">{channelLabel(order.channel)} · {tx("订单号")} {order.order_no}</p>
            {order.status === "pending" && <>
              {order.qr_code && <QRCodeCanvas value={order.qr_code} size={200} marginSize={4} title={tx("支付二维码")} />}
              {payURL && <a className="button" href={payURL} target="_blank" rel="noopener noreferrer">{tx("打开支付宝收银台")}</a>}
              <p className="muted">{tx("支付完成后自动更新到账结果")}</p>
            </>}
            <div className="payment-actions">
              {order.status === "succeeded" && <Link className="button" href="/playground">{tx("模型演练场")}</Link>}
              {order.status === "pending" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void refreshOrder(order)}>{tx("刷新订单状态")}</button>}
              <button type="button" className="secondary-button" disabled={busy} onClick={newOrder}>{order.status === "pending" ? tx("返回充值选择") : tx("继续充值")}</button>
            </div>
          </div>}
          {attempt && !order && !busy && <button type="button" className="secondary-button" onClick={newOrder}>{tx("新建充值订单")}</button>}

        </section>
      )}
      </div>
      <aside className="payment-panel payment-guide" aria-label={tx("充值流程")}>
        <h2>{tx("充值流程")}</h2>
        <ol>
          {[
            { title: tx("选择充值规格"), detail: tx("根据需要选择合适的充值金额") },
            { title: tx("选择支付方式"), detail: tx("支持支付宝、微信扫码支付") },
            { title: tx("扫码完成支付"), detail: tx("使用手机扫描二维码支付") },
            { title: tx("余额即时到账"), detail: tx("支付成功后余额立即更新") },
          ].map((step, index) => <li key={step.title}>
            <span className={`payment-guide-index ${index === 3 ? "complete" : ""}`} aria-hidden="true">{index === 3 ? <Check size={16} /> : index + 1}</span>
            <span><strong>{step.title}</strong><small>{step.detail}</small></span>
          </li>)}
        </ol>
      </aside>
      </div>
      <section className="section payment-history" aria-label={tx("充值订单")}>
        <h2>{tx("充值订单")}</h2>
        <PaymentHistoryTable label={tx("充值订单")} columns={[tx("充值金额"), tx("支付方式"), tx("时间"), tx("状态"), tx("操作")]}
          pagination={orderHistory.pagination} total={orderHistory.total} loading={orderHistory.loading}
          rows={orders.map(item => [
            <div key="amount"><strong>{amountLabel(item.amount_fen)}</strong><small>{item.order_no}</small></div>,
            channelLabel(item.channel),
            item.created_at ? new Intl.DateTimeFormat(languageLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at * 1000)) : "—",
            <span key="status" className="payment-history-status" data-status={item.status}>{statusLabel(item.status)}</span>,
            <button key="action" type="button" className="text-button" disabled={busy} onClick={() => void refreshOrder(item)}>{item.status === "pending" ? tx("继续支付") : tx("查看详情")}</button>,
          ])} />
      </section>

    </section>
  );
}
