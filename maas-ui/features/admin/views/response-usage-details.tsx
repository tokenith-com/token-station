import { useMemo } from "react";
import type { RequestPayloadLog } from "../core/types";
import { responseUsage } from "../domain/response-usage";
import { usageFieldGroup, type UsageFieldGroup } from "../domain/usage-field-groups";
import { languageLocale, tx } from "../i18n/runtime";

export function ResponseUsageDetails({ payload }: { payload: RequestPayloadLog | null }) {
  const usage = useMemo(() => responseUsage(payload?.response_body ?? ""), [payload?.response_body]);
  let nodes = 0;
  const number = new Intl.NumberFormat(languageLocale(), { maximumFractionDigits: 20 });
  function field(name: string, value: unknown, depth: number): React.ReactNode {
    if (++nodes > 1600 || depth > 16) return null;
    if (value !== null && typeof value === "object") {
      return <details key={name} open className="usage-field-object"><summary><code>{name}</code></summary><div>{Object.entries(value).slice(0, 1600).map(([key, child]) => field(key, child, depth + 1))}</div></details>;
    }
    return <div key={name} className="usage-field-row"><code>{name}</code><span>{typeof value === "number" ? number.format(value) : JSON.stringify(value)}</span></div>;
  }
  const labels: Record<UsageFieldGroup, string> = { input: tx("输入用量"), output: tx("输出用量"), total: tx("总量字段"), other: tx("其他用量字段") };
  return <section className="response-usage-details" aria-label={tx("响应中的全部用量字段")}>
    <p className="diagnostic-caption">{tx("按响应实际保存的字段展示；未返回的字段不补零，多条记录可能是累计值，请勿直接相加。")}</p>
    <p className="usage-field-help">{tx("分类仅用于阅读。相同数值的不同字段可能是别名或包含关系，不代表额外消耗。")}</p>
    {payload?.response_truncated || usage.captureTruncated ? <p className="diagnostic-warning">{tx("内容已截断，仅展示已保存的部分。")}</p> : null}
    {usage.records.length ? usage.records.map((record, index) => {
      const entries = Object.entries(record.value as object);
      return <div className="usage-record" key={record.path}>
        <div className="usage-record-source"><span>{tx("响应用量")}{usage.records.length > 1 ? ` ${number.format(index + 1)}` : ""}</span><code>{record.path}</code></div>
        <div className="usage-field-groups">{([["input", "total"], ["output", "other"]] as const).map((column, columnIndex) => <div className="usage-field-column" key={columnIndex}>{column.map(group => {
          const fields = entries.filter(([key]) => usageFieldGroup(key) === group);
          if (!fields.length) return null;
          return <section className={`usage-field-group is-${group}`} aria-label={labels[group]} key={group}><h4>{labels[group]}</h4><div>{fields.map(([key, value]) => field(key, value, 0))}</div></section>;
        })}</div>)}</div>
      </div>;
    }) : <p className="compact-empty">{tx("未采集原始用量；标准化计量请查看 Token 与成本。")}</p>}
    {usage.limited || nodes > 1600 ? <p className="diagnostic-warning">{tx("展示已达上限，请查看原始内容")}</p> : null}
  </section>;
}
