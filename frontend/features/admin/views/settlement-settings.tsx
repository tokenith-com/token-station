"use client";

import { Info } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { TeamWalletExchangeRate, TeamWalletExchangeRateHistory } from "../core/usage-report-types";
import type { ApiContext } from "../core/types";
import { formatTranslationTemplate, languageLocale, tx } from "../i18n/runtime";
import { adminFetch, isAuthExpiredError, readAdminError } from "../resources/payloads";

const exchangeRatePath = "/api/admin/team-wallet/exchange-rate";

export function validSettlementRate(value: string) {
  return /^\d{1,18}(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
}

function normalizedRate(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
}

export function SettlementSettingsView({ api }: { api: ApiContext }) {
  const [rate, setRate] = useState<TeamWalletExchangeRate>();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const pendingSave = useRef(false);
  const [history, setHistory] = useState<TeamWalletExchangeRateHistory>();
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyPage, setHistoryPage] = useState({ offset: 0, revision: 0 });

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    setHistory(undefined);
    async function loadHistory() {
      try {
        const response = await adminFetch(api, `${exchangeRatePath}/history?limit=50&offset=${historyPage.offset}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await readAdminError(response, tx("汇率保存历史加载失败")));
        const payload = await response.json() as TeamWalletExchangeRateHistory;
        if (!controller.signal.aborted) setHistory(payload);
      } catch (reason) {
        if (!controller.signal.aborted && !isAuthExpiredError(reason)) setHistoryError(reason instanceof Error ? reason.message : tx("汇率保存历史加载失败"));
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [api, historyPage]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRate(undefined);
    setInput("");
    setNotice("");
    async function load() {
      try {
        const response = await adminFetch(api, exchangeRatePath, { signal: controller.signal });
        if (!response.ok) throw new Error(await readAdminError(response, tx("结算汇率加载失败")));
        const payload = await response.json() as TeamWalletExchangeRate;
        if (controller.signal.aborted) return;
        setRate(payload);
        setInput(payload.configured ? payload.usd_to_cny : "");
      } catch (reason) {
        if (controller.signal.aborted || isAuthExpiredError(reason)) return;
        setError(reason instanceof Error ? reason.message : tx("结算汇率加载失败"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [api, revision]);

  const valid = validSettlementRate(input);
  const unchanged = rate?.configured && normalizedRate(input) === normalizedRate(rate.usd_to_cny);
  const canSave = Boolean(rate) && valid && !unchanged && !loading && !saving;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || pendingSave.current) return;
    pendingSave.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await adminFetch(api, exchangeRatePath, { method: "PUT", body: JSON.stringify({ usd_to_cny: input }) });
      if (!response.ok) throw new Error(await readAdminError(response, tx("结算汇率保存失败")));
      const payload = await response.json() as TeamWalletExchangeRate;
      setRate(payload);
      setInput(payload.usd_to_cny);
      setNotice(tx("结算汇率已保存"));
      setHistoryPage(page => ({ offset: 0, revision: page.revision + 1 }));
    } catch (reason) {
      if (!isAuthExpiredError(reason)) setError(reason instanceof Error ? reason.message : tx("结算汇率保存失败"));
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="settings-view settlement-settings">
      <section className="section system-settings-section" aria-labelledby="settlement-rate-heading" aria-busy={loading || saving}>
        <div className="section-header"><h2 id="settlement-rate-heading">{tx("结算汇率")}</h2></div>
        <div className="section-body">
          <div className="system-settings-preference">
            <div>
              <p className="eyebrow">{tx("全局平台范围")}</p>
              <strong>{loading ? tx("加载中") : rate ? rate.configured ? tx("汇率已配置") : tx("汇率未配置") : tx("结算汇率加载失败")}</strong>
              <span>{tx("当前结算按 1:1 计价，保存的汇率不参与扣费。此配置保留供后续使用。")}</span>
            </div>
            {!loading && !rate ? <button className="secondary-button" onClick={() => setRevision(value => value + 1)} type="button">{tx("重试")}</button> : null}
          </div>
          {error ? <p className="provider-quota-error" role="alert">{error}</p> : null}
          {notice ? <p className="notice" role="status">{notice}</p> : null}
          <form onSubmit={event => void save(event)}>
            <label htmlFor="settlement-usd-to-cny">{tx("美元兑人民币汇率")}</label>
            <div className="field" style={{ display: "flex", alignItems: "center", gap: 12, marginBlock: 12 }}>
              <span style={{ whiteSpace: "nowrap" }}>1 USD =</span>
              <input id="settlement-usd-to-cny" type="text" inputMode="decimal" autoComplete="off" value={input} disabled={!rate || loading || saving}
                aria-describedby="settlement-rate-help" aria-invalid={input !== "" && !valid}
                style={{ width: "min(100%, 240px)", minWidth: 0 }}
                onChange={event => { setInput(event.target.value); setNotice(""); }} />
              <span>CNY</span>
            </div>
            <p id="settlement-rate-help" className={input !== "" && !valid ? "provider-quota-error" : "muted"}>{tx("请输入大于零的十进制数，整数部分 1–18 位，小数最多 6 位。")}</p>
            <button className="button" style={{ marginTop: 16 }} type="submit" disabled={!canSave}>{saving ? tx("保存中") : tx("保存配置")}</button>
          </form>
        </div>
      </section>
      <section className="section settlement-history" aria-labelledby="settlement-history-heading" aria-busy={historyLoading}>
        <div className="section-header"><h2 id="settlement-history-heading">{tx("汇率保存历史")}</h2></div>
        <div className="section-body">
          <p className="muted">{tx("历史从功能上线后的成功保存开始记录，既有缺失记录无法恢复。")}</p>
          {historyLoading ? <p role="status">{tx("加载中")}</p> : historyError ? <div>
            <p className="provider-quota-error" role="alert">{historyError}</p>
            <button className="secondary-button" type="button" onClick={() => setHistoryPage(page => ({ ...page, revision: page.revision + 1 }))}>{tx("重试")}</button>
          </div> : history ? <>
            {history.entries.length ? <table className="settlement-history-table">
              <thead><tr><th>{tx("汇率")}</th><th>{tx("保存时间")}</th><th>{tx("操作人")}</th></tr></thead>
              <tbody>{history.entries.map(entry => <tr key={entry.id}>
                <td data-label={tx("汇率")}>1 USD = {entry.usd_to_cny} CNY</td>
                <td data-label={tx("保存时间")}><time dateTime={entry.created_at}>{new Intl.DateTimeFormat(languageLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(entry.created_at))}</time></td>
                <td data-label={tx("操作人")}>{entry.actor_name || entry.actor_user_id}</td>
              </tr>)}</tbody>
            </table> : <p>{tx("暂无汇率保存记录")}</p>}
            {history.total > 50 || history.offset > 0 ? <nav className="settlement-history-pagination" aria-label={tx("汇率历史分页")}>
              <button className="secondary-button" type="button" disabled={history.offset === 0} onClick={() => setHistoryPage(page => ({ ...page, offset: Math.max(0, history.offset - 50) }))}>{tx("上一页")}</button>
              <span className="muted">{formatTranslationTemplate(tx("第 {page} 页，共 {total} 条"), { page: new Intl.NumberFormat(languageLocale()).format(Math.floor(history.offset / 50) + 1), total: new Intl.NumberFormat(languageLocale()).format(history.total) })}</span>
              <button className="secondary-button" type="button" disabled={history.offset + history.limit >= history.total} onClick={() => setHistoryPage(page => ({ ...page, offset: history.offset + history.limit }))}>{tx("下一页")}</button>
            </nav> : null}
          </> : null}
        </div>
      </section>
      <section className="section" aria-labelledby="settlement-rules-heading">
        <div className="section-header"><h2 id="settlement-rules-heading">{tx("汇率生效规则")}</h2></div>
        <div className="section-body settlement-rules-body">
          <div className="system-settings-note settlement-rules-note" role="note"><Info size={18} aria-hidden="true" /><span>{tx("新汇率仅用于后续调用预扣；进行中的预扣请求继续使用原汇率快照。")}</span></div>
          <p className="muted settlement-rules-footnote">{tx("保存汇率不会重算历史账单，也不会直接改变团队余额。")}</p>
        </div>
      </section>
    </div>
  );
}
