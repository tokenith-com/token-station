import { useState } from "react";
import type { ApiContext } from "../core/types";
import { tx } from "../i18n/runtime";
import { formatWalletMicros, walletRequest } from "../resources/wallet";

type PaymentOrder = { order_no: string; amount_fen: number; status: string; channel: string };
type PendingUsage = { request_id: string; model: string; reserved_micros: number };
type WalletOperation = { path: string; payload: Record<string, string | number> };

export function WalletOperations({ api }: { api: ApiContext }) {
  const [orders, setOrders] = useState<PaymentOrder[]>();
  const [pending, setPending] = useState<PendingUsage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [requestID, setRequestID] = useState("");
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState("");
  const [operation, setOperation] = useState<WalletOperation>();

  async function load(next?: WalletOperation) {
    setBusy(true);
    setError("");
    try {
      if (next) {
        await walletRequest(api, next.path, { method: "POST", body: JSON.stringify(next.payload) });
        setOperation(undefined);
        setReason("");
        setCharge("");
      }
      const query = new URLSearchParams({ status: "pending_review" });
      if (requestID.trim()) query.set("request_id", requestID.trim());
      const [payments, usage] = await Promise.all([
        walletRequest<{ data: PaymentOrder[] }>(api, "/api/admin/payment-orders"),
        walletRequest<{ data: PendingUsage[] }>(api, `/api/admin/payment-wallet/usage?${query}`),
      ]);
      setOrders(payments.data);
      setPending(usage.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("请求失败"));
    } finally {
      setBusy(false);
    }
  }

  function prepareRefund() {
    if (!reason.trim() || !orderNumber.trim()) return;
    setOperation({ path: `/api/admin/payment-orders/${encodeURIComponent(orderNumber.trim())}/refunds`, payload: { reason: reason.trim() } });
  }

  function prepareResolution() {
    const micros = Number(charge);
    if (!reason.trim() || !requestID.trim() || !/^\d+$/.test(charge) || !Number.isSafeInteger(micros)) return;
    setOperation({ path: `/api/admin/payment-wallet/usage/${encodeURIComponent(requestID.trim())}/resolve`, payload: { reason: reason.trim(), charged_micros: micros } });
  }

  return <section className="section">
    <h2>{tx("支付与钱包对账")}</h2>
    <button className="secondary-button" type="button" disabled={busy || Boolean(operation)} onClick={() => void load()}>{tx("查询支付与待结算请求")}</button>
    {error && <p role="alert">{error}</p>}
    {orders && <>
      <h3>{tx("充值订单")}</h3>
      <ul>{orders.map((order) => <li key={order.order_no}>
        <button type="button" className="text-button" disabled={busy || Boolean(operation)} onClick={() => setOrderNumber(order.order_no)}>{order.order_no}</button>
        {" · "}{order.channel}{" · "}{formatWalletMicros(order.amount_fen * 10_000)}{" · "}{order.status}
      </li>)}</ul>
      <h3>{tx("待结算请求")}</h3>
      <ul>{pending.map((entry) => <li key={entry.request_id}>
        <button type="button" className="text-button" disabled={busy || Boolean(operation)} onClick={() => setRequestID(entry.request_id)}>{entry.request_id}</button>
        {" · "}{entry.model}{" · "}{formatWalletMicros(entry.reserved_micros)}
      </li>)}</ul>
      <div className="toolbar">
        <label>{tx("订单号")} <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} disabled={busy || Boolean(operation)} /></label>
        <label>{tx("请求 ID")} <input value={requestID} onChange={(event) => setRequestID(event.target.value)} disabled={busy || Boolean(operation)} /></label>
        <label>{tx("扣费金额（百万分之一元）")} <input value={charge} onChange={(event) => setCharge(event.target.value)} inputMode="numeric" disabled={busy || Boolean(operation)} /></label>
        <label>{tx("对账或退款原因")} <input value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || Boolean(operation)} /></label>
      </div>
      {operation ? <div className="toolbar">
        <button className="button" type="button" disabled={busy} onClick={() => void load(operation)}>{operation.payload.charged_micros === undefined ? tx("确认全额退款") : tx("确认钱包结算")}</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setOperation(undefined)}>{tx("取消")}</button>
      </div> : <div className="toolbar">
        <button className="secondary-button" type="button" disabled={busy || !orderNumber.trim() || !reason.trim()} onClick={prepareRefund}>{tx("申请全额退款")}</button>
        <button className="secondary-button" type="button" disabled={busy || !requestID.trim() || !reason.trim() || !/^\d+$/.test(charge)} onClick={prepareResolution}>{tx("结算待核对请求")}</button>
      </div>}
    </>}
  </section>;
}
