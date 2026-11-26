import { responseUsage } from "../domain/response-usage";
import { useMemo, useState } from "react";
import { copyText } from "../domain/clipboard";
import { formatTranslationTemplate, tx } from "../i18n/runtime";
import type { RequestPayloadLog } from "../core/types";

const maxNodes = 1200;
const maxDepth = 12;
function parse(body: string) { try { return { valid: true, value: JSON.parse(body) as unknown }; } catch { return { valid: false, value: null }; } }
function contains(key: string, value: unknown, query: string) { return !query || key.toLowerCase().includes(query) || JSON.stringify(value).toLowerCase().includes(query); }

function JSONTree({ value, query, expanded }: { value: unknown; query: string; expanded: boolean }) {
  let nodes = 0;
  function branch(key: string, item: unknown, depth: number): React.ReactNode {
    if (++nodes > maxNodes || !contains(key, item, query)) return null;
    if (depth >= maxDepth) return <div key={key} className="diagnostic-limit">{key}: {tx("嵌套过深，请查看原始内容")}</div>;
    if (item !== null && typeof item === "object") {
      const entries = Object.entries(item);
      return <details key={key} open={expanded || Boolean(query)} className="diagnostic-node">
        <summary><code>{key}</code><span>{Array.isArray(item) ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>
        <div>{entries.slice(0, maxNodes).map(([name, child]) => branch(name, child, depth + 1))}</div>
      </details>;
    }
    const text = JSON.stringify(item);
    return <div key={key} className={`diagnostic-value${query ? " is-match" : ""}`}><code>{key}</code>{typeof text === "string" && text.length > 600
      ? <details><summary>{tx("展开长内容")}</summary><pre>{text}</pre></details>
      : <span>{text}</span>}</div>;
  }
  const entries = value !== null && typeof value === "object" ? Object.entries(value) : [["$", value]];
  const children = entries.slice(0, maxNodes).map(([key, item]) => branch(String(key), item, 0));
  return <div className="diagnostic-tree">{children.some(Boolean) ? children : <p>{tx("没有匹配项")}</p>}{nodes > maxNodes ? <p>{tx("展示已达上限，请查看原始内容")}</p> : null}</div>;
}


export function RequestPayloadViewer({ payload }: { payload: RequestPayloadLog | null }) {
  const [tab, setTab] = useState<"request" | "response">("request");
  const [raw, setRaw] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [copy, setCopy] = useState<"ok" | "failed" | null>(null);
  const request = payload?.request_body ?? "";
  const response = payload?.response_body ?? "";
  const body = tab === "request" ? request : response;
  const parsed = useMemo(() => parse(body), [body]);
  const responseParsed = useMemo(() => parse(response), [response]);
  const usage = useMemo(() => responseUsage(response).records, [response]);
  const stream = responseParsed.value && typeof responseParsed.value === "object" ? responseParsed.value as Record<string, unknown> : null;
  const truncated = tab === "request" ? payload?.request_truncated : payload?.response_truncated;
  const streamTruncated = tab === "response" && stream?.truncated === true;
  const normalizedQuery = query.toLowerCase().trim();
  const displayBody = parsed.valid ? JSON.stringify(parsed.value, null, 2) : body;
  const filtered = normalizedQuery ? displayBody.split("\n").filter(line => line.toLowerCase().includes(normalizedQuery)).join("\n") : displayBody;
  function select(next: "request" | "response") { setTab(next); setQuery(""); setCopy(null); }
  if (!payload) return <div className="compact-empty">{tx("这条历史记录没有保存 request / response 快照")}</div>;
  return <section className="request-diagnostics" aria-label={tx("请求与响应")}>
    <div className="diagnostic-tabs" role="tablist" aria-label={tx("报文类型")}>
      <button type="button" role="tab" aria-selected={tab === "request"} onClick={() => select("request")}>{tx("请求参数")}</button>
      <button type="button" role="tab" aria-selected={tab === "response"} onClick={() => select("response")}>{tx("响应内容")}</button>
    </div>
    <details className="diagnostic-content-disclosure" key={tab}><summary>{tx("展开报文内容")}</summary>
    <div className="diagnostic-tools">
      <input type="search" aria-label={tx("搜索参数或内容")} placeholder={tx("搜索参数或内容")} value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" onClick={() => setRaw(value => !value)}>{raw ? tx("参数树") : tx("原始内容")}</button>
      {!raw && parsed.valid ? <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? tx("收起嵌套") : tx("全部展开")}</button> : null}
      <button type="button" disabled={!body} onClick={async () => { const copiedBody = body; const ok = await copyText(copiedBody); setCopy(ok ? "ok" : "failed"); }}>{tx("复制内容")}</button>
      {copy ? <span role="status">{copy === "ok" ? tx("已复制") : tx("复制失败，请选中文本手动复制。")}</span> : null}
    </div>
    {truncated || streamTruncated ? <p className="diagnostic-warning">{tx("内容已截断，仅展示已保存的部分。")}</p> : null}
    {tab === "response" && stream?.stream === true ? <p className="diagnostic-notice">{stream.capture_kind === "bounded_sse_events"
      ? tx("以下为已采集的脱敏流事件，不是完整网络报文。") : tx("此历史流仅保存状态摘要，未采集响应正文。")}
      {stream.capture_kind === "bounded_sse_events" ? <span> {stream.terminal_observed === true ? tx("已观测到协议结束标记") : tx("已保存范围内未观测到结束标记")}</span> : null}</p> : null}
    <div role="tabpanel" aria-label={tab === "request" ? tx("请求参数") : tx("响应内容")} className="diagnostic-body">
      {!body ? <p className="compact-empty">{tx(tab === "request" ? "未记录请求内容" : "未记录响应内容")}</p>
        : raw || !parsed.valid ? <><p className="diagnostic-caption">{!parsed.valid ? tx("非完整 JSON，按原始文本展示") : normalizedQuery ? tx("仅显示匹配行；复制仍包含已保存的完整内容。") : tx("已保存的脱敏内容")}</p><pre>{filtered || tx("没有匹配项")}</pre></>
        : <JSONTree key={`${tab}:${expanded}:${normalizedQuery}`} value={parsed.value} query={normalizedQuery} expanded={expanded} />}
    </div>
    {tab === "response" ? <details className="diagnostic-usage"><summary>{tx("查看原始 usage")}</summary>{usage.length ? usage.map((item, index) => <div key={index}><p>{formatTranslationTemplate(tx("用量记录 {index}"), { index: String(index + 1) })}</p><pre>{JSON.stringify(item.value, null, 2)}</pre></div>) : <p>{tx("未采集原始用量；标准化计量请查看 Token 与成本。")}</p>}</details> : null}
    </details>
    <p className="diagnostic-caption">{tx("仅超管可见。敏感字段已脱敏；历史缺失内容无法恢复。")}</p>
  </section>;
}
