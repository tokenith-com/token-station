import { Activity, Coins, Receipt, RefreshCw, Wallet } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import type { ApiContext, AppData, UsageBreakdownRow } from "../core/types";
import type { UsageRange } from "../core/usage-report-types";
import { apiKeyAuditLabel } from "../domain/entities";
import { compactNumber, formatNumber } from "../domain/formatting";
import { languageLocale, tx } from "../i18n/runtime";
import { usePaymentHistory, type PaymentOrder } from "../resources/payment-history";
import { PaymentHistoryTable } from "../shared/payment-history-table";
import { formatWalletMicros, walletRequest, type Wallet as WalletData } from "../resources/wallet";
import { SimpleTable } from "../shared/ui";
import { useUsageReport } from "./use-usage-report";

type WalletUsage = { request_id: string; model: string; status: string; charged_micros: number; created_at?: number };
type HistoryTab = "orders" | "usage";
const historyTabs = [{ key: "orders", label: "充值记录" }, { key: "usage", label: "消费流水" }] as const;

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

function formatDate(value: number | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(languageLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value * 1000));
}

export function GuestCostDetailsView({ api, data }: { api: ApiContext; data: AppData }) {
  const [range, setRange] = useState<UsageRange>("30d");
  const { report, error, refreshing, refresh } = useUsageReport(api, range);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletError, setWalletError] = useState("");
  const [historyTab, setHistoryTab] = useState<HistoryTab>("orders");
  const historyId = useId();
  const orderHistory = usePaymentHistory<PaymentOrder>(api, "/api/admin/recharge/orders", historyTab === "orders");
  const usageHistory = usePaymentHistory<WalletUsage>(api, "/api/admin/wallet/usage", historyTab === "usage");
  const refreshUsage = usageHistory.refresh;
  const { rows: orders, error: ordersError, refresh: loadOrders } = orderHistory;

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

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const refreshAll = useCallback(() => {
    refresh();
    void loadWallet();
    if (historyTab === "orders") loadOrders();
    else refreshUsage();
  }, [historyTab, loadOrders, loadWallet, refresh, refreshUsage]);

  function handleHistoryKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextTab: HistoryTab;
    if (event.key === "Home") nextTab = "orders";
    else if (event.key === "End") nextTab = "usage";
    else nextTab = historyTab === "orders" ? "usage" : "orders";
    setHistoryTab(nextTab);
    document.getElementById(`${historyId}-${nextTab}-tab`)?.focus();
  }

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

      <section className="cost-panel cost-history">
        <div className="cost-history-tabs" role="tablist" aria-label={tx("费用明细")} onKeyDown={handleHistoryKeyDown}>
          {historyTabs.map(tab => (
            <button key={tab.key} type="button" role="tab" id={`${historyId}-${tab.key}-tab`}
              aria-selected={historyTab === tab.key} aria-controls={`${historyId}-${tab.key}-panel`}
              tabIndex={historyTab === tab.key ? 0 : -1} onClick={() => setHistoryTab(tab.key)}>
              {tx(tab.label)}
            </button>
          ))}
        </div>
        <div className="cost-panel-body" role="tabpanel" id={`${historyId}-orders-panel`}
          aria-labelledby={`${historyId}-orders-tab`} hidden={historyTab !== "orders"} tabIndex={0}>
          {ordersError ? <div className="recharge-alert error" role="alert">{ordersError}</div> : null}
          <PaymentHistoryTable label={tx("充值记录")} columns={[tx("充值时间"), tx("支付方式"), tx("金额"), tx("状态")]} pagination={orderHistory.pagination} total={orderHistory.total} loading={orderHistory.loading} rows={orders.map(order => [
            formatDate(order.created_at),
            tx(order.channel === "alipay" ? "支付宝" : "微信支付"),
            <span key="amount" className="cost-money">{formatCNY(order.amount_fen ?? 0)}</span>,
            <span key="status" className="payment-history-status" data-status={order.status}>{order.status === "succeeded" ? tx("已支付") : tx(order.status === "closed" ? "订单已关闭" : order.status === "refunded" ? "已退款" : order.status === "refund_pending" ? "退款处理中" : "待支付")}</span>,
          ])} />
        </div>
        <div className="cost-panel-body" role="tabpanel" id={`${historyId}-usage-panel`}
          aria-labelledby={`${historyId}-usage-tab`} hidden={historyTab !== "usage"} tabIndex={0}>
          {usageHistory.error ? <div className="recharge-alert error" role="alert">{usageHistory.error}</div> : null}
          <PaymentHistoryTable label={tx("消费流水")} columns={[tx("模型"), tx("请求 ID"), tx("时间"), tx("金额"), tx("状态")]}
            pagination={usageHistory.pagination} total={usageHistory.total} loading={usageHistory.loading}
            rows={usageHistory.rows.map(entry => [
              entry.model,
              entry.request_id,
              formatDate(entry.created_at),
              entry.status === "settled" ? <strong key="amount">{formatWalletMicros(entry.charged_micros)}</strong> : "—",
              <span key="status" className="payment-history-status" data-status={entry.status}>{entry.status === "settled" ? tx("已结算") : entry.status === "released" ? tx("未扣费") : tx("待结算")}</span>,
            ])} />
        </div>
      </section>
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
