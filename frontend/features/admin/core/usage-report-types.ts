import type { Summary, UsageBreakdown, UsagePoint } from "./types";

export type UsageRange = "today" | "7d" | "30d" | "all";

export type TeamWalletExchangeRate = {
  usd_to_cny: string;
  configured: boolean;
  paid_calls_enabled: boolean;
};

export type TeamWalletExchangeRateHistoryEntry = {
  id: string;
  usd_to_cny: string;
  created_at: string;
  actor_user_id: string;
  actor_name: string;
};

export type TeamWalletExchangeRateHistory = {
  entries: TeamWalletExchangeRateHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
};

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
