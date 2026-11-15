import { Activity, Coins, Receipt, RefreshCw, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { ApiContext, AppData, UsageBreakdownRow } from "../core/types";
import type { UsageRange } from "../core/usage-report-types";
import { apiKeyAuditLabel } from "../domain/entities";
import { compactNumber, formatNumber } from "../domain/formatting";
import { languageLocale, tx } from "../i18n/runtime";
import { adminFetch, readAdminError } from "../resources/payloads";
import { SimpleTable } from "../shared/ui";
import { useUsageReport } from "./use-usage-report";

type WalletInfo = { balance_cents: number };

type RechargeOrder = {
  id: string;
  amount_cents: number;
  payment_method: "alipay" | "wechat";
  status: string;
  created_at: string;
};

const ranges: UsageRange[] = ["today", "7d", "30d", "all"];

function rangeLabel(range: UsageRange) {
  return { today: tx("今日"), "7d": tx("7 天"), "30d": tx("30 天"), all: tx("全部") }[range];
}

function formatCNY(cents: number) {
  return new Intl.NumberFormat(languageLocale(), { style: "currency", currency: "CNY", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2 }).format(cents / 100);
}

function usageMoney(value: number) {
  return new Intl.NumberFormat(languageLocale(), { style: "currency", currency: "CNY", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(languageLocale(), { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(languageLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function GuestCostDetailsView({ api, data }: { api: ApiContext; data: AppData }) {
  const [range, setRange] = useState<UsageRange>("30d");
  const { report, error, refreshing, refresh } = useUsageReport(api, range);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [ordersError, setOrdersError] = useState("");

  const loadWallet = useCallback(async () => {
    const resp = await adminFetch(api, "/api/admin/consumer/wallet");
    if (!resp.ok) throw new Error(await readAdminError(resp, tx("余额加载失败")));
    setWallet((await resp.json()) as WalletInfo);
  }, [api]);

  const loadOrders = useCallback(async () => {
    const resp = await adminFetch(api, "/api/admin/consumer/recharge-orders");
    if (!resp.ok) throw new Error(await readAdminError(resp, tx("充值记录加载失败")));
    setOrders(((await resp.json()) as { orders: RechargeOrder[] }).orders ?? []);
  }, [api]);

  useEffect(() => {
    loadWallet().catch(() => {});
    loadOrders().catch(err => setOrdersError(err instanceof Error ? err.message : tx("充值记录加载失败")));
  }, [loadWallet, loadOrders]);

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
          <button className="cost-refresh" type="button" disabled={refreshing} onClick={refresh} aria-label={tx("刷新")} title={tx("刷新")}>
            <RefreshCw size={15} className={refreshing ? "is-spinning" : undefined} />
          </button>
        </div>
      </header>

      {error ? <div className="recharge-alert error" role="alert">{tx("费用明细加载失败")}</div> : null}

      <div className="cost-kpis">
        <Kpi tone="balance" icon={<Wallet size={18} />} label={tx("账户余额")} value={formatCNY(wallet?.balance_cents ?? 0)} />
        <Kpi tone="purple" icon={<Receipt size={18} />} label={tx("估算成本")} value={summary ? usageMoney(summary.estimated_cost_usd) : "—"} />
        <Kpi tone="blue" icon={<Activity size={18} />} label={tx("请求数")} value={summary ? formatNumber(summary.request_count) : "—"} />
        <Kpi tone="green" icon={<Coins size={18} />} label={tx("总 Token")} value={summary ? compactNumber(summary.total_tokens) : "—"} />
      </div>

      <div className="cost-details-grid">
        <CostTable title={tx("模型成本")} label={tx("模型")} rows={report?.breakdown.models ?? []} paginationKey="cost-models" name={row => row.id} />
        <CostTable title={tx("API Key 成本")} label="API Key" rows={report?.breakdown.api_keys ?? []} paginationKey="cost-api-keys" name={row => apiKeyAuditLabel(data, row.id)} />
      </div>

      <CostPanel title={tx("充值记录")}>
        {ordersError ? <div className="recharge-alert error" role="alert">{ordersError}</div> : null}
        <SimpleTable columns={[tx("充值时间"), tx("支付方式"), tx("金额"), tx("状态")]} paginationKey="cost-orders" rows={orders.map(order => [
          formatDate(order.created_at),
          tx(order.payment_method === "alipay" ? "支付宝" : "微信支付"),
          <span key="amount" className="cost-money">{formatCNY(order.amount_cents)}</span>,
          order.status === "paid" ? <span className="cost-status is-paid">{tx("已支付")}</span> : <span className="cost-status is-pending">{tx("待支付")}</span>,
        ])} />
      </CostPanel>
    </section>
  );
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
