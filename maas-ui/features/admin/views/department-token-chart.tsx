import { useCustomerTerminology } from "../i18n/customer-copy";
import { useState } from "react";
import type { UsageBreakdownRow } from "../core/types";
import { compactNumber, formatNumber } from "../domain/formatting";
import { tx } from "../i18n/runtime";

type Row = UsageBreakdownRow & { name: string };
export function DepartmentTokenChart({ rows }: { rows: Row[] }) {
  const ui = useCustomerTerminology();
  const [active, setActive] = useState<string | null>(null);
  if (!rows.length) return <div className="empty">{ui("暂无客户团队 Token 数据")}</div>;
  const sorted = [...rows].sort((a, b) => b.total_tokens - a.total_tokens);
  const maximum = Math.max(1, ...sorted.flatMap(row => [row.input_tokens, row.output_tokens]));
  return <div className="department-token-chart">
    <div className="department-token-rows" role="list" aria-label={ui("客户团队 Token 消耗对比")}>
      {sorted.map(row => <div role="listitem" className={`department-token-row${active === row.id ? " is-active" : ""}`} key={row.id}>
        <div className="department-token-heading"><strong>{row.name}</strong><span>{compactNumber(row.total_tokens)} <small>Token</small></span></div>
        <div className="department-token-marks" tabIndex={0} aria-label={`${row.name} / ${tx("输入")} ${formatNumber(row.input_tokens)} / ${tx("输出")} ${formatNumber(row.output_tokens)} / ${tx("总量")} ${formatNumber(row.total_tokens)}`} onMouseEnter={() => setActive(row.id)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(row.id)} onBlur={() => setActive(null)}>
          <div className="department-token-series"><span>{tx("输入")}</span><div className="department-token-track"><i className="is-input" style={{ width: `${Math.max(0, row.input_tokens) / maximum * 100}%` }} /></div></div>
          <div className="department-token-series"><span>{tx("输出")}</span><div className="department-token-track"><i className="is-output" style={{ width: `${Math.max(0, row.output_tokens) / maximum * 100}%` }} /></div></div>
          {active === row.id ? <div className="department-token-tooltip" role="tooltip"><strong>{row.name}</strong><span>{tx("输入")} <b>{formatNumber(row.input_tokens)}</b></span><span>{tx("输出")} <b>{formatNumber(row.output_tokens)}</b></span><span>{tx("总量")} <b>{formatNumber(row.total_tokens)}</b></span></div> : null}
        </div>
      </div>)}
    </div>
    <div className="department-token-axis" aria-hidden="true"><span>0</span><span>{compactNumber(maximum / 2)}</span><span>{compactNumber(maximum)} Token</span></div>
    <details open className="department-token-table"><summary>{tx("查看数据表")}</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>{ui("客户团队")}</th><th>{tx("输入")}</th><th>{tx("输出")}</th><th>{tx("总量")}</th></tr></thead><tbody>{sorted.map(row => <tr key={row.id}><td>{row.name}</td><td>{formatNumber(row.input_tokens)}</td><td>{formatNumber(row.output_tokens)}</td><td>{formatNumber(row.total_tokens)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
