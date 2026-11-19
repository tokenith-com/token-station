import { Activity, Coins, Receipt, RefreshCw, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { ApiContext, AppData, UsageBreakdownRow } from "../core/types";
import type { UsageRange } from "../core/usage-report-types";
import { apiKeyAuditLabel } from "../domain/entities";
import { compactNumber, formatNumber } from "../domain/formatting";
import { languageLocale, tx } from "../i18n/runtime";
import { adminFetch, readAdminError } from "../resources/payloads";
import { formatWalletMicros, walletRequest, type Wallet as WalletData } from "../resources/wallet";
import { SimpleTable } from "../shared/ui";
import { useUsageReport } from "./use-usage-report";

type WalletUsage = {
  request_id: string;
  model: string;
  status: string;
  charged_micros: number;
  created_at: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: string;
};

const ranges: UsageRange[] = ["today", "7d", "30d", "all"];

function rangeLabel(range: UsageRange) {
  return { today: tx("今日"), "7d": tx("7 天"), "30d": tx("30 天"), all: tx("全部") }[range];
}

function usageMoney(value: number) {
  return new Intl.NumberFormat(languageLocale(), { style: "currency", currency: "USD", currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(languageLocale(), { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function GuestCostDetailsView({ api, data }: { api: ApiContext; data: AppData }) {
  const [range, setRange] = useState<UsageRange>("30d");
  const { report, error, refreshing, refresh } = useUsageReport(api, range);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletError, setWalletError] = useState("");
  const [usage, setUsage] = useState<WalletUsage[]>([]);
  const [usageError, setUsageError] = useState("");

  const loadWallet = useCallback(async () => {
    setWalletError("");
    try {
      const next = await walletRequest<WalletData>(api, "/api/admin/wallet");
      setWallet(next);
      window.dispatchEvent(new Event("tokenstation-wallet-updated"));
    } catch (reason) {
      setWalletError(reason instanceof Error ? reason.message : tx("余额加载失败"));
    }
  }, [api]);

  const loadUsage = useCallback(async () => {
    setUsageError("");
    try {
      const resp = await adminFetch(api, "/api/admin/wallet/usage?limit=50");
      if (!resp.ok) throw new Error(await readAdminError(resp, tx("消费流水加载失败")));
      setUsage(((await resp.json()) as { data: WalletUsage[] }).data ?? []);
    } catch (reason) {
      setUsageError(reason instanceof Error ? reason.message : tx("消费流水加载失败"));
    }
  }, [api]);

  useEffect(() => {
    void loadWallet();
    void loadUsage();
  }, [loadWallet, loadUsage]);

  const refreshAll = useCallback(() => {
    refresh();
    void loadWallet();
    void loadUsage();
  }, [loadUsage, loadWallet, refresh]);

  const summary = report?.summary;
  return (
    <section className="cost-details" aria-label={tx("费用明细")}>
      <header className="cost-header">
        <div>
          <h1>{tx("费用明细")}</h1>
          <p>{tx("查看您的余额、费用与充值记录")}</p>
        </div>
        <div className="cost-toolbar">
          <div className="cost-ranges" role="group" aria-label={tx("费用时间范围")}>
            {ranges.map(value => (
              <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{rangeLabel(value)}</button>
            ))}
          </div>
          <button className="cost-refresh" type="button" disabled={refreshing} onClick={refreshAll} aria-label={tx("刷新")} title={tx("刷新")}>
            <RefreshCw size={15} className={refreshing ? "is-spinning" : undefined} />
          </button>
        </div>
      </header>

      {error ? <div className="recharge-alert error" role="alert">{tx("费用明细加载失败")}</div> : null}
      {walletError ? <div className="recharge-alert error" role="alert">{walletError}</div> : null}

      <div className="cost-kpis">
        <Kpi tone="balance" icon={<Wallet size={18} />} label={tx("账户余额")} value={wallet ? formatWalletMicros(wallet.available_micros) : "—"} />
        <Kpi tone="purple" icon={<Receipt size={18} />} label={tx("估算成本")} value={summary ? usageMoney(summary.estimated_cost_usd) : "—"} />
        <Kpi tone="blue" icon={<Activity size={18} />} label={tx("请求数")} value={summary ? formatNumber(summary.request_count) : "—"} />
        <Kpi tone="green" icon={<Coins size={18} />} label={tx("总 Token")} value={summary ? compactNumber(summary.total_tokens) : "—"} />
      </div>

      <div className="cost-details-grid">
        <CostTable title={tx("模型成本")} label={tx("模型")} rows={report?.breakdown.models ?? []} paginationKey="cost-models" name={row => row.id} />
        <CostTable title={tx("API Key 成本")} label="API Key" rows={report?.breakdown.api_keys ?? []} paginationKey="cost-api-keys" name={row => apiKeyAuditLabel(data, row.id)} />
      </div>

      <CostPanel title={tx("消费流水")}>
        {usageError ? <div className="recharge-alert error" role="alert">{usageError}</div> : null}
        {!usageError && usage.length === 0 ? <p className="muted">{tx("暂无消费记录")}</p> : null}
        {usage.length > 0 ? <SimpleTable columns={[tx("时间"), tx("模型"), tx("输入"), tx("输出"), tx("合计 Token"), tx("扣费"), tx("状态"), tx("请求 ID")]} paginationKey="cost-usage" rows={usage.map(entry => [
          formatWalletUsageTime(entry.created_at),
          entry.model,
          formatNumber(entry.input_tokens),
          formatNumber(entry.output_tokens),
          formatNumber(entry.total_tokens),
          <span key="charged" className="cost-money">{entry.status === "settled" ? formatWalletMicros(entry.charged_micros) : "—"}</span>,
          <span key="status" className={`cost-status ${entry.status === "settled" ? "is-paid" : "is-pending"}`}>{tx(walletUsageStatusLabel(entry.status))}</span>,
          <code key="rid" className="cost-request-id">{entry.request_id}</code>,
        ])} /> : null}
      </CostPanel>
    </section>
  );
}

function walletUsageStatusLabel(status: string) {
  return { settled: "已结算", released: "未扣费", pending: "待结算", pending_review: "待核对" }[status] ?? "处理中";
}

function formatWalletUsageTime(seconds: number) {
  if (!seconds) return "—";
  return new Intl.DateTimeFormat(languageLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(seconds * 1000));
}

function Kpi({ tone, icon, label, value }: { tone: string; icon: ReactNode; label: string; value: string }) {
  return (
    <div className={`cost-kpi is-${tone}`}>
      <span className="cost-kpi-icon" aria-hidden="true">{icon}</span>
      <div className="cost-kpi-body">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function CostPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cost-panel">
      <h2>{title}</h2>
      <div className="cost-panel-body">{children}</div>
    </section>
  );
}

function CostTable({ title, label, rows, name, paginationKey }: {
  title: string; label: string; rows: UsageBreakdownRow[]; name: (row: UsageBreakdownRow) => string; paginationKey: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.estimated_cost_usd, 0);
  const sorted = [...rows].sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);
  return (
    <CostPanel title={title}>
      <SimpleTable columns={[label, "请求", "Token", "成本", "占比"]} paginationKey={paginationKey} rows={sorted.map(row => {
        const share = total > 0 ? row.estimated_cost_usd / total : 0;
        return [
          <span key="name" className="cost-name">{name(row)}</span>,
          formatNumber(row.request_count),
          compactNumber(row.total_tokens),
          <span key="cost" className="cost-money">{usageMoney(row.estimated_cost_usd)}</span>,
          <span key="share" className="cost-share">
            <span className="cost-share-track"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
            <small>{formatPercent(share)}</small>
          </span>,
        ];
      })} />
    </CostPanel>
  );
}
