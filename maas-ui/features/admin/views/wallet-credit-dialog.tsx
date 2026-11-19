import { useRef, useState } from "react";
import type { ApiContext } from "../core/types";
import { adminFetch } from "../resources/payloads";
import { useModalFocus } from "../shared/modal-focus";
import { loadWalletLedger, pendingWalletKey, readPendingCredit, walletMoney, walletPath, yuanFromMicros, yuanToMicros, type WalletCopy, type WalletCredit, type WalletEntry } from "./wallet-contract";

export function WalletCreditDialog({ api, userID, teamID, teamName, owner, balance, balanceError, onRetryBalance, copy, onClose, onSaved }: {
  api: ApiContext; userID: string; teamID: string; teamName: string; owner: string;
  balance?: number; balanceError?: boolean; onRetryBalance?: () => void; copy: WalletCopy; onClose: () => void; onSaved: () => void;
}) {
  const { tx, locale } = copy;
  const storageKey = pendingWalletKey(api, userID, teamID);
  const [restored, setRestored] = useState(() => { try { return { payload: readPendingCredit(storageKey), failed: false }; } catch { return { failed: true }; } });
  const [pending, setPending] = useState<WalletCredit | undefined>(restored.payload);
  const [amount, setAmount] = useState(restored.payload ? yuanFromMicros(restored.payload.amount_micros) : "");
  const [creditType, setCreditType] = useState<WalletCredit["credit_type"]>(restored.payload?.credit_type ?? "offline_receipt");
  const [remark, setRemark] = useState(restored.payload?.remark ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(restored.failed ? tx("无法安全保存待确认操作，请恢复会话存储后重试") : restored.payload ? tx("结果尚未确认。请使用原请求重试，切勿重复入账。") : "");
  const focus = useModalFocus(() => { if (!inFlight.current) onClose(); });
  const micros = yuanToMicros(amount);
  const balanceReady = !balanceError && balance !== undefined && Number.isSafeInteger(balance) && balance >= 0;
  const projected = micros !== undefined && balanceReady && Number.isSafeInteger(balance! + micros) ? balance! + micros : undefined;
  const validRemark = Boolean(remark.trim()) && [...remark.trim()].length <= 1000;
  const valid = projected !== undefined && validRemark;
  const prerequisite = !balanceReady ? tx("请等待余额成功加载后再确认入账") : micros === undefined ? tx("金额必须为正数，最多六位小数。") : !validRemark ? tx("请填写非空备注，最多1000字") : projected === undefined ? tx("预计余额超出安全范围，请减少入账金额") : !confirmed ? tx("请先勾选核实收款或授信信息") : "";
  function retryStorage() {
    try {
      const payload = readPendingCredit(storageKey);
      setRestored({ payload, failed: false });
      setPending(payload);
      if (payload) {
        setAmount(yuanFromMicros(payload.amount_micros));
        setCreditType(payload.credit_type); setRemark(payload.remark);
      }
      setConfirmed(false);
      setError(payload ? tx("结果尚未确认。请使用原请求重试，切勿重复入账。") : "");
    } catch { setError(tx("无法安全保存待确认操作，请恢复会话存储后重试")); }
  }
  function complete(entry: WalletEntry, payload: WalletCredit) {
    if ((entry.kind && entry.kind !== "credit") || entry.actor_user_id !== userID || entry.team_id !== teamID || entry.request_id !== payload.request_id || entry.amount_micros !== payload.amount_micros || entry.credit_type !== payload.credit_type || entry.remark !== payload.remark) throw new Error("Mismatched wallet credit response");
    sessionStorage.removeItem(storageKey);
    setPending(undefined);
    onSaved();
  }
  async function submit() {
    if (inFlight.current || restored.failed || (!pending && (!valid || !confirmed))) return;
    inFlight.current = true; setBusy(true); setError("");
    let payload = pending;
    let sent = false;
    try {
      if (payload) {
        const ledger = await loadWalletLedger(api, teamID, 0, payload.request_id);
        const found = ledger.entries.find(entry => entry.kind === "credit" && entry.request_id === payload!.request_id);
        if (found) { complete(found, payload); return; }
      } else {
        payload = { amount_micros: micros!, credit_type: creditType, remark: remark.trim(), request_id: crypto.randomUUID() };
        sessionStorage.setItem(storageKey, JSON.stringify(payload));
        setPending(payload);
      }
      sent = true;
      const response = await adminFetch(api, `${walletPath(teamID)}/credits`, { method: "POST", body: JSON.stringify(payload) });
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408 && response.status !== 409 && !pending) {
          sessionStorage.removeItem(storageKey); setPending(undefined); setConfirmed(false); sent = false;
        }
        throw new Error(String(response.status));
      }
      const result = await response.json();
      if (result.currency !== "USD") throw new Error("Invalid wallet currency");
      complete(result.entry, payload);
    } catch {
      setError(tx(sent || pending ? "结果尚未确认。请使用原请求重试，切勿重复入账。" : payload ? "入账失败，请检查信息后重试" : "无法安全保存待确认操作，请恢复会话存储后重试"));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="modal-backdrop"><div {...focus} className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-credit-title"><form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="modal-header"><h2 id="wallet-credit-title">{tx("团队入账")}</h2><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{tx("关闭")}</button></div>
    <div className="modal-body wallet-credit-body">
      <p className="wallet-full-row">{tx("仅记录线下收款或授信入账，不提供在线支付。")}</p>
      <label className="field"><span>{tx("团队名称")}</span><input readOnly value={teamName} /></label>
      <label className="field"><span>{tx("负责人")}</span><input readOnly value={owner} /></label>
      <p className="wallet-full-row wallet-balance-summary">{tx("当前余额")} <strong>{walletMoney(balance, locale)}</strong></p>
      {balanceError ? <p role="alert"><button type="button" className="secondary-button" onClick={onRetryBalance}>{tx("余额加载失败，重试")}</button></p> : balance === undefined ? <p role="status">{tx("加载中")}</p> : null}
      <label className="field"><span>{tx("入账金额（USD）")}</span><input inputMode="decimal" required value={amount} disabled={Boolean(pending) || busy || restored.failed} onChange={event => { setAmount(event.target.value); setConfirmed(false); }} /></label>
      <label className="field"><span>{tx("入账类型")}</span><select value={creditType} disabled={Boolean(pending) || busy || restored.failed} onChange={event => { setCreditType(event.target.value as WalletCredit["credit_type"]); setConfirmed(false); }}><option value="offline_receipt">{tx("线下收款")}</option><option value="approved_credit">{tx("授信入账")}</option></select></label>
      <p className="wallet-full-row">{tx("金额必须为正数，最多六位小数。")}</p>
      <label className="field wallet-full-row"><span>{tx("备注（必填，最多1000字）")}</span><textarea required maxLength={1000} value={remark} disabled={Boolean(pending) || busy || restored.failed} onChange={event => { setRemark(event.target.value); setConfirmed(false); }} /></label>
      <p>{tx("预计入账后余额")} <strong>{walletMoney(projected, locale)}</strong></p>
      {!pending ? <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{tx("我已核实收款或授信信息，确认入账")}</label> : <p role="status">{tx("结果尚未确认。请使用原请求重试，切勿重复入账。")}<br />{tx("请求 ID")}: {pending.request_id}</p>}
      {!pending && !restored.failed && prerequisite ? <p role="status" className="wallet-full-row">{prerequisite}</p> : null}
      {error ? <p role="alert" className="billing-inline-error">{error}</p> : null}
      {restored.failed ? <button type="button" className="secondary-button" onClick={retryStorage}>{tx("重新读取待确认操作")}</button> : null}
    </div><div className="modal-actions"><button className="button" type="submit" disabled={busy || restored.failed || (!pending && (!valid || !confirmed))}>{busy ? tx("正在确认入账…") : pending ? tx("使用原请求重试") : tx("确认入账")}</button></div>
  </form></div></div>;
}
