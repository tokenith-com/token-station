"use client";

import { ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ApiContext, type AppData, type UsagePoint } from "../core/types";
import { compactNumber, formatMoney, formatNumber } from "../domain/formatting";
import { tx } from "../i18n/runtime";
import { cacheHitRate, executiveDepartmentRows, executiveMemberRows, type ExecutiveMemberRow } from "./usage-billing";
import { useUsageReport } from "./use-usage-report";

type OverviewRange = "7d" | "30d" | "custom";
type OverviewMetric = "requests" | "tokens" | "cost";

const rangeOptions: Array<{ key: OverviewRange; label: string }> = [
  { key: "7d", label: "最近7天" },
  { key: "30d", label: "最近30天" },
  { key: "custom", label: "自定义" },
];

const metricOptions: Array<{ key: OverviewMetric; label: string }> = [
  { key: "requests", label: "请求" },
  { key: "tokens", label: "Token" },
  { key: "cost", label: "成本" },
];

export function PlatformOverviewContent({ api, data }: { api: ApiContext; data: AppData }) {
  const [range, setRange] = useState<OverviewRange>("7d");
  const [metric, setMetric] = useState<OverviewMetric>("requests");
  const points = overviewDashboardPoints(data.timeseries, range);
  const { report, error, refresh } = useUsageReport(api, "all");
  const rankingData = useMemo(() => report ? { ...data, summary: report.summary, breakdown: report.breakdown, timeseries: report.timeseries } : undefined, [data, report]);
  const members = useMemo(() => rankingData ? executiveMemberRows(rankingData) : [], [rankingData]);
  const totalTokens = rankingData ? rankingData.summary.total_tokens || executiveDepartmentRows(rankingData).reduce((sum, row) => sum + row.total_tokens, 0) : 0;
  const activeMembers = members.filter(row => row.total_tokens > 0 || row.request_count > 0).length;
  const activeProviders = data.providers.filter(provider => provider.status === "active" && provider.healthy).length;
  const compactTotalTokens = compactNumber(data.summary.total_tokens);

  return (
    <div className="platform-overview">
      <section className="platform-overview-section">
        <header className="platform-overview-heading">
          <div className="platform-overview-range-row">
            <div className="platform-overview-range dashboard-segmented-control" role="tablist" aria-label={tx("报表时间范围")}>
              {rangeOptions.map(option => (
                <button aria-selected={range === option.key} className={range === option.key ? "active" : ""} key={option.key} onClick={() => setRange(option.key)} role="tab" type="button">
                  {tx(option.label)}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="platform-overview-kpis">
          <OverviewKpi label="总请求数" tone="cyan" value={formatNumber(data.summary.request_count)} />
          <OverviewKpi
            detail={`${tx("输入")} ${compactNumber(data.summary.input_tokens)}  /  ${tx("输出")} ${compactNumber(data.summary.output_tokens)}`}
            label="总token"
            tone="blue"
            unit={compactTotalTokens.match(/[KM]$/)?.[0]}
            value={compactTotalTokens.replace(/[KM]$/, "")}
          />
          <OverviewKpi label="总成本" prefix="$" tone="indigo" value={formatMoney(data.summary.estimated_cost_usd)} />
          <OverviewKpi label="Provider" tone="violet" value={`${formatNumber(activeProviders)} / ${formatNumber(data.providers.length)}`} />
        </div>

        <article className="platform-overview-panel platform-overview-trend">
          <div className="platform-overview-panel-head">
            <h2>{tx("成本与用量趋势")}</h2>
            <div className="platform-overview-metrics dashboard-segmented-control" role="tablist" aria-label={tx("趋势指标")}>
              {metricOptions.map(option => (
                <button aria-selected={metric === option.key} className={metric === option.key ? "active" : ""} key={option.key} onClick={() => setMetric(option.key)} role="tab" type="button">
                  {tx(option.label)}
                </button>
              ))}
            </div>
          </div>
          <OverviewTrendChart metric={metric} points={points} />
        </article>
      </section>

      <section className="platform-overview-section platform-overview-users">
        <h2 className="dashboard-section-heading">{tx("全局用户")}</h2>
        <article className="overview-member-summary">
          <div>
            <span className="dashboard-kpi-label">{tx("活跃成员")}</span>
            <strong className="dashboard-kpi-value">{report ? formatNumber(activeMembers) : "-"}</strong>
          </div>
          <small className="dashboard-kpi-detail">
            <b>{tx("统计时间")}</b> {statisticsTime(report?.timeseries ?? [])}
          </small>
          <span className="overview-member-summary-art" aria-hidden="true" />
        </article>

        <article className="platform-overview-panel overview-member-ranking">
          <div className="platform-overview-panel-head">
            <h2>{tx("用户排名")}</h2>
          </div>
          {error ? <div className="overview-member-empty" role="alert">
            <p>{error}</p>
            <button className="secondary-button" onClick={refresh} type="button">{tx("重试")}</button>
          </div> : report ? <MemberRankingTable rows={members} totalTokens={totalTokens} /> : <div className="overview-member-empty" role="status">{tx("加载中...")}</div>}
        </article>
      </section>
    </div>
  );
}

export function OverviewKpi({ label, value, detail, tone, unit, prefix }: { label: string; value: string; detail?: string; tone: "cyan" | "blue" | "indigo" | "violet"; unit?: string; prefix?: string }) {
  return (
    <article className={`platform-overview-kpi ${tone}`}>
      <div className="platform-overview-kpi-copy">
        <span className="dashboard-kpi-label">{tx(label)}</span>
        <strong className="dashboard-kpi-value">
          {prefix ? <em>{prefix}</em> : null}
          {value}
          {unit ? <small className="dashboard-kpi-unit">{tx(unit)}</small> : null}
        </strong>
        {detail ? <small className="dashboard-kpi-detail">{detail}</small> : null}
      </div>
      <span className="platform-overview-kpi-art" aria-hidden="true" />
    </article>
  );
}

function OverviewTrendChart({ points, metric }: { points: UsagePoint[]; metric: OverviewMetric }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(1000);
  const chartRef = useRef<SVGSVGElement>(null);
  const values = points.map(point => overviewPointValue(point, metric));
  const maxValue = niceChartMaximum(Math.max(...values, 1));
  const chartPoints = values.map((value, index) => ({
    x: 72 + index * (points.length <= 1 ? 0 : (chartWidth - 146) / (points.length - 1)),
    y: 224 - (value / maxValue) * 210,
  }));
  const safeActiveIndex = activeIndex === null || points.length === 0 ? null : Math.min(Math.max(activeIndex, 0), points.length - 1);
  const activePoint = safeActiveIndex === null ? undefined : chartPoints[safeActiveIndex];
  const activeData = safeActiveIndex === null ? undefined : points[safeActiveIndex];
  const linePath = smoothPath(chartPoints);
  const areaPath = chartPoints.length ? `${linePath} L ${chartPoints[chartPoints.length - 1].x.toFixed(2)} 224 L ${chartPoints[0].x.toFixed(2)} 224 Z` : "";
  const ticks = [1, 0.75, 0.5, 0.25, 0];

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const updateChartWidth = () => {
      const bounds = chart.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setChartWidth(Math.max(320, (bounds.width / bounds.height) * 282));
    };
    updateChartWidth();
    const observer = new ResizeObserver(updateChartWidth);
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="overview-trend-chart">
      <svg
        ref={chartRef}
        viewBox={`0 0 ${chartWidth} 282`}
        role="img"
        aria-label={tx("成本与用量趋势图")}
        preserveAspectRatio="none"
        onPointerCancel={() => setActiveIndex(null)}
        onPointerLeave={() => setActiveIndex(null)}
        onPointerMove={event => {
          if (chartPoints.length === 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const pointerX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
          const nearestIndex = chartPoints.reduce((nearest, point, index) => (Math.abs(point.x - pointerX) < Math.abs(chartPoints[nearest].x - pointerX) ? index : nearest), 0);
          setActiveIndex(nearestIndex);
        }}>
        <defs>
          <linearGradient id="overviewTrendArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8a5fc4" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#8a5fc4" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map(tick => {
          const y = 14 + (1 - tick) * 210;
          return (
            <g key={tick}>
              <line className="overview-chart-gridline" x1="72" x2={chartWidth - 74} y1={y} y2={y} />
              <text className="overview-chart-y-label" x="60" y={y + 4} textAnchor="end">
                {formatAxisValue(maxValue * tick, metric)}
              </text>
            </g>
          );
        })}
        {areaPath ? <path d={areaPath} fill="url(#overviewTrendArea)" /> : null}
        {linePath ? <path className="overview-chart-line" d={linePath} /> : null}
        {activePoint ? <line className="overview-chart-cursor" x1={activePoint.x} x2={activePoint.x} y1="14" y2="224" /> : null}
        {chartPoints.map((point, index) => (
          <g key={`${points[index]?.date}-${index}`}>
            <circle className="overview-chart-point" cx={point.x} cy={point.y} r="3.5" />
            <text className="overview-chart-x-label" x={point.x} y="254" textAnchor="middle">
              {shortDate(points[index]?.date)}
            </text>
          </g>
        ))}
      </svg>
      {activePoint && activeData ? (
        <div
          className={activePoint.x > chartWidth * 0.7 ? "overview-chart-tooltip align-left" : "overview-chart-tooltip"}
          style={{ left: `${(activePoint.x / chartWidth) * 100}%`, top: `${Math.min(61, (activePoint.y / 282) * 100 + 7)}%` }}>
          <strong>{shortDate(activeData.date)}</strong>
          <span>
            <i />
            {tx(metric === "requests" ? "请求数" : metricOptions.find(option => option.key === metric)?.label ?? "请求")} <b>{formatTooltipValue(overviewPointValue(activeData, metric), metric)}</b>
          </span>
        </div>
      ) : null}
      <div className="overview-chart-legend">
        <i />
        {tx(metric === "requests" ? "请求数" : metricOptions.find(option => option.key === metric)?.label ?? "请求")}
      </div>
    </div>
  );
}

function MemberRankingTable({ rows, totalTokens }: { rows: ExecutiveMemberRow[]; totalTokens: number }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [shareSort, setShareSort] = useState<"desc" | "asc">("desc");
  if (rows.length === 0) return <div className="overview-member-empty">{tx("暂无用户用量数据")}</div>;
  const sortedRows = shareSort === "desc" ? rows : rows.slice().sort((left, right) => left.total_tokens - right.total_tokens || left.request_count - right.request_count || left.estimated_cost_usd - right.estimated_cost_usd);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * pageSize;
  const pagedRows = sortedRows.slice(startIndex, startIndex + pageSize);
  return (
    <>
      <div className="overview-member-table-wrap">
        <table className="overview-member-table">
          <thead>
            <tr>
              <th>{tx("排名")}</th>
              <th>{tx("成员")}</th>
              <th>{tx("部门")}</th>
              <th>{tx("Key（已用/归属）")}</th>
              <th>{tx("请求")}</th>
              <th>{tx("输入 token")}</th>
              <th>{tx("缓存读")}</th>
              <th>{tx("缓存命中率")}</th>
              <th>{tx("输出 token")}</th>
              <th>{tx("总 token")}</th>
              <th aria-sort={shareSort === "desc" ? "descending" : "ascending"}>
                <button
                  className={shareSort === "asc" ? "overview-member-sort asc" : "overview-member-sort"}
                  onClick={() => setShareSort(value => (value === "desc" ? "asc" : "desc"))}
                  title={tx("按占比排序")}
                  type="button">
                  {tx("占比")}
                  <ListFilter size={13} />
                </button>
              </th>
              <th>{tx("成本")}</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row, index) => {
              const share = totalTokens > 0 ? (row.total_tokens / totalTokens) * 100 : 0;
              const cachedTokens = row.cached_input_tokens ?? 0;
              return (
                <tr key={row.id}>
                  <td>{startIndex + index + 1}</td>
                  <td><span className="overview-member-name" title={row.name}>{row.name}</span></td>
                  <td>
                    {row.department !== "-" ? <span className="overview-member-remark" title={row.department}>{row.department}</span> : "-"}
                  </td>
                  <td>{formatNumber(row.used_key_count ?? 0)} / {formatNumber(row.owned_key_count ?? 0)}</td>
                  <td>{formatNumber(row.request_count)}</td>
                  <td>{formatNumber(row.input_tokens)}</td>
                  <td>{formatNumber(cachedTokens)}</td>
                  <td>{cacheHitRate(cachedTokens, row.input_tokens)}</td>
                  <td>{formatNumber(row.output_tokens)}</td>
                  <td>{formatNumber(row.total_tokens)}</td>
                  <td>{share.toFixed(share >= 10 ? 0 : 1)}%</td>
                  <td>${formatMoney(row.estimated_cost_usd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="overview-member-pagination">
        <span>
          {tx("共")} {formatNumber(rows.length)} {tx("条")}
        </span>
        <div>
          <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} title={tx("上一页")} type="button">
            <ChevronLeft size={14} />
          </button>
          {paginationPages(pageCount, safePage).map(pageNumber => (
            <button className={pageNumber === safePage ? "active" : ""} key={pageNumber} onClick={() => setPage(pageNumber)} type="button">
              {pageNumber}
            </button>
          ))}
          <button disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)} title={tx("下一页")} type="button">
            <ChevronRight size={14} />
          </button>
          <select
            aria-label={tx("每页条数")}
            value={pageSize}
            onChange={event => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}>
            {[10, 20, 50, 100].map(size => (
              <option key={size} value={size}>
                {size} {tx("条/页")}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

function paginationPages(pageCount: number, currentPage: number) {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const start = Math.min(Math.max(currentPage - 2, 1), pageCount - 4);
  return Array.from({ length: 5 }, (_, index) => start + index);
}

function overviewDashboardPoints(points: UsagePoint[], range: OverviewRange) {
  const count = range === "7d" ? 7 : range === "30d" ? 30 : 14;
  return points.slice(-count);
}

function overviewPointValue(point: UsagePoint, metric: OverviewMetric) {
  if (metric === "tokens") return point.total_tokens;
  if (metric === "cost") return point.estimated_cost_usd;
  return point.request_count;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    const previous = points[index - 1];
    const controlX = (previous.x + point.x) / 2;
    return `${path} C ${controlX.toFixed(2)} ${previous.y.toFixed(2)}, ${controlX.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, "");
}

function shortDate(value?: string) {
  if (!value) return "-";
  const [, month, day] = value.slice(0, 10).split("-");
  return `${month}/${day}`;
}

function statisticsTime(points: UsagePoint[]) {
  return shortDate(points.at(-1)?.date);
}

function niceChartMaximum(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function formatTooltipValue(value: number, metric: OverviewMetric) {
  if (metric === "cost") return `$${formatMoney(value)}`;
  if (metric === "tokens") return compactNumber(Math.round(value));
  return formatNumber(Math.round(value));
}

function formatAxisValue(value: number, metric: OverviewMetric) {
  if (metric === "cost") return `$${value >= 100 ? value.toFixed(0) : value.toFixed(1)}`;
  return compactNumber(Math.round(value));
}
