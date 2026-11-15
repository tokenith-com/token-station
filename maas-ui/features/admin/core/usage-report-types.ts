import type { Summary, UsageBreakdown, UsagePoint } from "./types";

export type TeamWalletResponse = {
  wallet: { team_id: string; balance_cents: number; updated_at: string };
  currency: "CNY";
  paid_calls_enabled: boolean;
};

export type TeamWalletExchangeRate = {
  usd_to_cny: string;
  configured: boolean;
  paid_calls_enabled: boolean;
};

export type UsageRange = "today" | "7d" | "30d" | "all";

export type UsageReport = {
  range: UsageRange;
  timezone: string;
  window_start: string;
  window_end: string;
  granularity: "hour" | "day" | "month";
  summary: Summary;
  breakdown: UsageBreakdown;
  timeseries: UsagePoint[];
};
