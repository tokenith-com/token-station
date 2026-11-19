import { useEffect, useRef, useState } from "react";
import { tx } from "../i18n/runtime";
import { formatWalletMicros } from "../resources/wallet";

export type WalletAction = { kind: "refund" | "settlement"; id: string; amountMicros: number; model?: string };

export function parseWalletCharge(value: string): number | null {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
}

export function WalletActionDialog({ action, busy, error, onDismiss, onConfirm }: { action: WalletAction; busy: boolean; error: string; onDismiss: () => void; onConfirm: (reason: string, charge?: number) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState("");
  const [confirm, setConfirm] = useState(false);
  const refund = action.kind === "refund";
  const micros = parseWalletCharge(charge);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const title = refund ? tx("申请全额退款") : tx("结算待核对请求");
  return <dialog ref={dialog} className="billing-action-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onDismiss(); }}>
    <header className="billing-panel-heading"><h2>{title}</h2><button className="text-button" type="button" disabled={busy} onClick={onDismiss}>{tx("关闭")}</button></header>
    <form onSubmit={event => { event.preventDefault(); if (!reason.trim() || (!refund && micros === null)) return; if (!confirm) setConfirm(true); else void onConfirm(reason.trim(), refund ? undefined : micros!); }}>
      <dl className="billing-action-summary"><div><dt>{refund ? tx("订单号") : tx("请求 ID")}</dt><dd>{action.id}</dd></div>{action.model && <div><dt>{tx("模型")}</dt><dd>{action.model}</dd></div>}<div><dt>{refund ? tx("退款金额") : tx("冻结金额")}</dt><dd>{formatWalletMicros(action.amountMicros)}</dd></div></dl>
      {error && <p className="billing-notice error" role="alert">{error}</p>}
      {confirm ? <div className="billing-confirmation"><h3>{refund ? tx("确认全额退款") : tx("确认钱包结算")}</h3>{!refund && <p>{tx("扣费金额（元）")} <strong>{formatWalletMicros(micros!)}</strong></p>}<p>{reason}</p><p className="billing-help">{tx("确认后将更新钱包流水，请核对金额和原因。")}</p></div> : <fieldset disabled={busy} className="billing-form-fields">
        {!refund && <label>{tx("扣费金额（元）")}<input required inputMode="decimal" maxLength={32} value={charge} onChange={event => setCharge(event.target.value)} /><small>{tx("支持最多 6 位小数，零元结算将释放冻结金额。")}</small></label>}
        <label>{tx("对账或退款原因")}<textarea required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
      </fieldset>}
      <footer className="billing-dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => confirm ? setConfirm(false) : onDismiss()}>{confirm ? tx("返回修改") : tx("取消")}</button><button className="button" type="submit" disabled={busy || !reason.trim() || (!refund && micros === null)}>{busy ? tx("处理中") : confirm ? refund ? tx("确认全额退款") : tx("确认钱包结算") : title}</button></footer>
    </form>
  </dialog>;
}
