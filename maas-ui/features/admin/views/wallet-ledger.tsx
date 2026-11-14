import { useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import { loadWalletLedger, walletReadErrorCopy, walletMoney, type WalletCopy, type WalletLedgerResponse } from "./wallet-contract";

export function WalletLedger(props: { api: ApiContext; teamID: string; copy: WalletCopy }) {
  return <WalletLedgerContent key={`${props.api.baseURL}:${props.api.adminToken}:${props.teamID}`} {...props} />;
}
function WalletLedgerContent({ api, teamID, copy }: { api: ApiContext; teamID: string; copy: WalletCopy }) {
  const { tx, locale } = copy;
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data?: WalletLedgerResponse; error?: string }>({});
  useEffect(() => {
    let active = true;
    if (teamID) void loadWalletLedger(api, teamID, offset).then(data => { if (active) setState({ data }); }, error => { if (active) setState({ error: walletReadErrorCopy(error) }); });
    return () => { active = false; };
  }, [api, teamID, offset, revision]);
  function page(next: number) { setState({}); setOffset(next); }
  return <section aria-label={tx("资金流水")}>
    <h3>{tx("资金流水")}</h3>
    {!teamID ? <p>{tx("未关联团队，无法读取钱包")}</p> : state.error ? <div role="alert">{tx("资金流水加载失败")}：{tx(state.error)} <button type="button" className="secondary-button" onClick={() => { setState({}); setRevision(value => value + 1); }}>{tx("重试")}</button></div> : !state.data ? <p role="status">{tx("正在加载资金流水…")}</p> : <>
      {state.data.entries.length === 0 ? <p>{tx("暂无资金流水")}</p> : <div className="table-scroll wallet-ledger-scroll"><table className="data-table wallet-ledger-table"><thead><tr>{[tx("时间"), tx("类型"), tx("状态"), tx("实际金额（CNY）"), tx("预留金额（CNY）"), tx("入账前余额"), tx("入账后余额"), tx("操作人"), tx("备注"), tx("请求 ID")].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{state.data.entries.map(entry => <tr key={`${entry.kind}:${entry.id}`}>
        <td>{entry.created_at ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at)) : "—"}</td>
        <td>{entry.kind === "call" ? tx("模型调用") : entry.credit_type === "offline_receipt" ? tx("线下收款") : entry.credit_type === "approved_credit" ? tx("授信入账") : tx("历史入账")}</td>
        <td>{entry.status === "reserved" ? tx("预留中") : entry.status === "settled" ? tx("已结算") : entry.status === "released" ? tx("已释放") : entry.status === "settlement_failed" ? tx("结算失败") : entry.status === "credited" ? tx("已入账") : "—"}</td>
        <td>{walletMoney(entry.actual_amount_cents ?? (entry.kind === "call" ? undefined : entry.amount_cents), locale)}</td><td>{entry.kind === "call" ? walletMoney(entry.reserved_cents, locale) : "—"}</td><td>{walletMoney(entry.before_balance_cents, locale)}</td><td>{walletMoney(entry.after_balance_cents, locale)}</td>
        <td>{entry.actor_name || entry.actor_user_id || "—"}</td><td style={{ overflowWrap: "anywhere" }}>{entry.remark || "—"}</td><td>{entry.request_id}</td>
      </tr>)}</tbody></table></div>}
      <div className="modal-actions"><button className="secondary-button" type="button" disabled={offset === 0} onClick={() => page(Math.max(0, offset - 20))}>{tx("上一页")}</button><span>{new Intl.NumberFormat(locale).format(state.data.total)} {tx("条记录")}</span><button className="secondary-button" type="button" disabled={offset + 20 >= state.data.total} onClick={() => page(offset + 20)}>{tx("下一页")}</button></div>
    </>}
  </section>;
}
