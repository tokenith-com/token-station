import { useCustomerTerminology } from "../i18n/customer-copy";
import { useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import { PaginationControls, usePagination } from "../shared/pagination";
import { loadWalletLedger, walletReadErrorCopy, walletMoney, type WalletCopy, type WalletLedgerResponse } from "./wallet-contract";

export function WalletLedger(props: { api: ApiContext; teamID: string; copy: WalletCopy }) {
  return <WalletLedgerContent key={`${props.api.baseURL}:${props.api.adminToken}:${props.teamID}`} {...props} />;
}
function WalletLedgerContent({ api, teamID, copy }: { api: ApiContext; teamID: string; copy: WalletCopy }) {
  const ui = useCustomerTerminology();
  const { tx, locale } = copy;
  const [total, setTotal] = useState(0);
  const pagination = usePagination(total, teamID);
  const offset = pagination.startIndex;
  const limit = pagination.pageSize;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data?: WalletLedgerResponse; error?: string }>({});
  useEffect(() => {
    let active = true;
    if (teamID) void loadWalletLedger(api, teamID, offset, undefined, limit).then(data => { if (active) { setTotal(data.total); setState({ data }); } }, error => { if (active) setState({ error: walletReadErrorCopy(error) }); });
    return () => { active = false; };
  }, [api, teamID, offset, limit, revision]);
  const controls = { ...pagination,
    setPage: (next: number) => { if (next === pagination.page) return; setState({}); pagination.setPage(next); },
    setPageSize: (next: number) => { if (next === pagination.pageSize) return; setState({}); pagination.setPageSize(next); },
  };
  return <section aria-label={tx("资金流水")}>
    <h3>{tx("资金流水")}</h3>
    {!teamID ? <p>{ui("未关联团队，无法读取钱包")}</p> : state.error ? <div role="alert">{tx("资金流水加载失败")}：{tx(state.error)} <button type="button" className="secondary-button" onClick={() => { setState({}); setRevision(value => value + 1); }}>{tx("重试")}</button></div> : !state.data ? <p role="status">{tx("正在加载资金流水…")}</p> : <>
      {state.data.entries.length === 0 ? <p>{tx("暂无资金流水")}</p> : <div className="table-scroll wallet-ledger-scroll"><table className="data-table wallet-ledger-table"><thead><tr>{[tx("时间"), tx("类型"), tx("状态"), tx("实际金额（USD）"), tx("预留金额（USD）"), tx("入账前余额"), tx("入账后余额"), tx("操作人"), tx("备注"), tx("请求 ID")].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{state.data.entries.map(entry => <tr key={`${entry.kind}:${entry.id}`}>
        <td>{entry.created_at ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at)) : "—"}</td>
        <td>{entry.kind === "call" ? tx("模型调用") : entry.credit_type === "offline_receipt" ? tx("线下收款") : entry.credit_type === "approved_credit" ? tx("授信入账") : tx("历史入账")}</td>
        <td>{entry.status === "reserved" ? tx("预留中") : entry.status === "settled" ? tx("已结算") : entry.status === "released" ? tx("已释放") : entry.status === "settlement_failed" ? tx("结算失败") : entry.status === "credited" ? tx("已入账") : "—"}</td>
        <td>{walletMoney(entry.actual_amount_micros ?? (entry.kind === "call" ? undefined : entry.amount_micros), locale)}</td><td>{entry.kind === "call" ? walletMoney(entry.reserved_micros, locale) : "—"}</td><td>{walletMoney(entry.before_balance_micros, locale)}</td><td>{walletMoney(entry.after_balance_micros, locale)}</td>
        <td>{entry.actor_name || entry.actor_user_id || "—"}</td><td style={{ overflowWrap: "anywhere" }}>{entry.remark || "—"}</td><td>{entry.request_id}</td>
      </tr>)}</tbody></table></div>}
      <PaginationControls pagination={controls} totalItems={total} alwaysVisible />
    </>}
  </section>;
}
