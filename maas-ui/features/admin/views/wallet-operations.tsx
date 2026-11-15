import { useCallback, useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import { tx } from "../i18n/runtime";
import { formatWalletMicros, walletRequest } from "../resources/wallet";
import { SimpleTable } from "../shared/ui";
import { WalletActionDialog, type WalletAction } from "./wallet-action-dialog";

type PaymentOrder = { order_no: string; amount_fen: number; status: string; channel: string };
type PendingUsage = { request_id: string; model: string; reserved_micros: number };

export function WalletOperations({ api }: { api: ApiContext }) {
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [pending, setPending] = useState<PendingUsage[]>([]);
  const [more, setMore] = useState({ orders: false, pending: false });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"orders" | "pending">("orders");
  const [action, setAction] = useState<WalletAction>();
  const { baseURL, adminToken } = api;
  const read = useCallback(async (signal?: AbortSignal) => {
    const context = { baseURL, adminToken };
    const [payments, usage] = await Promise.all([
      walletRequest<{ data: PaymentOrder[] }>(context, "/api/admin/payment-orders", { signal }),
      walletRequest<{ data: PendingUsage[] }>(context, "/api/admin/payment-wallet/usage?status=pending_review", { signal }),
    ]);
    setOrders(payments.data); setPending(usage.data);
    setMore({ orders: payments.data.length === 50, pending: usage.data.length === 50 });
  }, [baseURL, adminToken]);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : tx("请求失败")); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [read]);
  async function refresh() {
    setBusy(true); setError("");
    try { await read(); } catch (err) { setError(err instanceof Error ? err.message : tx("请求失败")); } finally { setBusy(false); }
  }
  async function loadMore() {
    setBusy(true); setError("");
    try {
      const offset = view === "orders" ? orders.length : pending.length;
      const path = view === "orders" ? `/api/admin/payment-orders?offset=${offset}` : `/api/admin/payment-wallet/usage?status=pending_review&offset=${offset}`;
      if (view === "orders") {
        const result = await walletRequest<{ data: PaymentOrder[] }>(api, path);
        setOrders(current => [...current, ...result.data.filter(item => !current.some(existing => existing.order_no === item.order_no))]);
        setMore(current => ({ ...current, orders: result.data.length === 50 }));
      } else {
        const result = await walletRequest<{ data: PendingUsage[] }>(api, path);
        setPending(current => [...current, ...result.data.filter(item => !current.some(existing => existing.request_id === item.request_id))]);
        setMore(current => ({ ...current, pending: result.data.length === 50 }));
      }
    } catch (err) { setError(err instanceof Error ? err.message : tx("请求失败")); } finally { setBusy(false); }
  }
  async function confirm(reason: string, chargedMicros?: number) {
    if (!action) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const path = action.kind === "refund" ? `/api/admin/payment-orders/${encodeURIComponent(action.id)}/refunds` : `/api/admin/payment-wallet/usage/${encodeURIComponent(action.id)}/resolve`;
      await walletRequest(api, path, { method: "POST", body: JSON.stringify({ reason, ...(chargedMicros === undefined ? {} : { charged_micros: chargedMicros }) }) });
      setAction(undefined); setNotice(tx("操作已提交，请以最新流水状态为准。"));
      await read();
    } catch (err) { setError(err instanceof Error ? err.message : tx("请求失败")); } finally { setBusy(false); }
  }
  const matches = (value: string) => value.toLowerCase().includes(search.trim().toLowerCase());
  return <section className="billing-panel" aria-label={tx("支付与钱包对账")}>
    <header className="billing-panel-heading"><div><h2>{tx("支付与钱包对账")}</h2><p>{tx("按订单处理退款，按请求核对冻结金额并完成结算。")}</p></div><button className="secondary-button" type="button" disabled={busy} onClick={() => void refresh()}>{tx("刷新")}</button></header>
    {error && !action && <p className="billing-notice error" role="alert">{error}</p>}
    {notice && <p className="billing-notice success" role="status">{notice}</p>}
    <div className="billing-list-toolbar"><div className="billing-segmented" role="group" aria-label={tx("对账记录")}><button type="button" aria-pressed={view === "orders"} onClick={() => setView("orders")}>{tx("充值订单")}</button><button type="button" aria-pressed={view === "pending"} onClick={() => setView("pending")}>{tx("待结算请求")}</button></div><input type="search" aria-label={tx("搜索订单或请求")} placeholder={tx("搜索订单或请求")} value={search} onChange={event => setSearch(event.target.value)} /></div>
    <p className="billing-help">{tx("搜索已加载的记录，可加载更早记录继续核对。")}</p>
    <div aria-busy={busy} className="billing-results">
      {busy && orders.length === 0 && pending.length === 0 ? <p className="billing-empty" role="status">{tx("加载中")}</p> : view === "orders" ? <SimpleTable columns={["订单号", "支付方式", "金额（元）", "状态", "操作"]} paginationKey="payment-reconciliation-orders" rows={orders.filter(order => matches(order.order_no)).map(order => [
        <span className="billing-identifier" key="id">{order.order_no}</span>, order.channel === "alipay" ? tx("支付宝") : order.channel === "wechat" ? tx("微信支付") : order.channel,
        formatWalletMicros(order.amount_fen * 10000), <span className={`billing-status ${order.status}`} key="status">{paymentStatus(order.status)}</span>,
        <button className="text-button" type="button" key="action" disabled={busy || order.status !== "succeeded"} onClick={() => { setError(""); setAction({ kind: "refund", id: order.order_no, amountMicros: order.amount_fen * 10000 }); }}>{tx("申请全额退款")}</button>,
      ])} /> : <SimpleTable columns={["请求 ID", "模型", "冻结金额", "操作"]} paginationKey="payment-reconciliation-pending" rows={pending.filter(entry => matches(`${entry.request_id} ${entry.model}`)).map(entry => [
        <span className="billing-identifier" key="id">{entry.request_id}</span>, entry.model, formatWalletMicros(entry.reserved_micros),
        <button className="text-button" key="action" type="button" disabled={busy} onClick={() => { setError(""); setAction({ kind: "settlement", id: entry.request_id, amountMicros: entry.reserved_micros, model: entry.model }); }}>{tx("结算待核对请求")}</button>,
      ])} />}
    </div>
    {more[view] && <div className="billing-form-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void loadMore()}>{tx("加载更早记录")}</button></div>}
    {action && <WalletActionDialog action={action} busy={busy} error={error} onDismiss={() => { setAction(undefined); setError(""); }} onConfirm={confirm} />}
  </section>;
}
function paymentStatus(status: string) {
  return ({ pending: tx("待支付"), succeeded: tx("充值已到账"), closed: tx("订单已关闭"), refunded: tx("已退款"), refund_pending: tx("退款处理中") })[status] ?? tx("订单状态待确认");
}
