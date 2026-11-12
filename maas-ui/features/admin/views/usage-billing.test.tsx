import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageRange, UsageReport } from "../core/usage-report-types";
import { emptyData } from "../domain/catalog";
import { DailyUsageSection, UsageView } from "./usage-billing";

const api = { baseURL: "http://example.test", adminToken: "synthetic-session" };
const member = { id: "member", username: "member", name: "Member", email: "member@example.test", role: "user", status: "active" };

function usageReport(range: UsageRange, tokens = 0): UsageReport {
  const data = emptyData();
  return {
    range, timezone: "UTC", window_start: "2026-10-28T00:00:00Z", window_end: "2026-10-28T12:00:00Z",
    granularity: "hour", summary: { ...data.summary, total_tokens: tokens, input_tokens: tokens }, breakdown: data.breakdown, timeseries: [],
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("UsageView project attribution", () => {
  it.each(["admin", "team_leader"] as const)("resolves project names and preserves unavailable identifiers for %s", async (role) => {
    const data = emptyData();
    data.projects = [{ id: "prj_design", name: "Design Platform", status: "active" }];
    data.breakdown.projects = ["prj_design", "prj_archived", "unknown", "prj_default"].map((id) => ({
      id, request_count: 2, input_tokens: 100, cached_input_tokens: 20,
      output_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.25,
    }));
    const user = { id: "usr_reviewer", username: "reviewer", name: "Usage Reviewer", email: "reviewer@example.test", role, status: "active" };
    data.users = [user];
    data.breakdown.members = [{ ...data.breakdown.projects[0], id: user.id }];

    const report: UsageReport = {
      range: "today", timezone: "UTC", window_start: "2026-09-07T00:00:00Z", window_end: "2026-09-07T02:00:00Z",
      granularity: "hour", summary: data.summary, breakdown: data.breakdown, timeseries: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(report))));
    render(<UsageView api={{ baseURL: "http://example.test", adminToken: "synthetic-session" }} data={data} user={user} />);

    const projectSection = (await screen.findByRole("heading", { name: "项目归因" })).closest("section")!;
    const projects = within(projectSection);
    const cost = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD" }).format(0.25);
    expect(projects.getByRole("row", { name: `Design Platform 2 150 20 ${cost}` })).toBeInTheDocument();
    expect(projects.queryByRole("cell", { name: "prj_design" })).not.toBeInTheDocument();
    expect(projects.getByRole("cell", { name: "prj_archived" })).toBeInTheDocument();
    expect(projects.getByRole("cell", { name: "unknown" })).toBeInTheDocument();
    expect(projects.getByRole("cell", { name: "默认项目空间" })).toBeInTheDocument();
    if (role === "team_leader") {
      const members = screen.getByRole("heading", { name: "成员用量" }).closest("section")!;
      expect(within(members).getByRole("cell", { name: "Usage Reviewer / reviewer@example.test" })).toBeInTheDocument();
    }
  });
});

describe("Usage aligned with the master report page", () => {
  it.each(["admin", "team_leader", "user", "guest"])("uses one selected range for metrics, trends and breakdowns for %s", async (role) => {
    const data = emptyData();
    data.summary.total_tokens = 111;
    data.dailyUsage.summary.total_tokens = 222;
    const ranges: UsageRange[] = ["today", "7d", "30d", "all"];
    const fetch = vi.fn(async (input: string) => {
      const range = new URL(input, "http://example.test").searchParams.get("range") as UsageRange;
      const tokens = (ranges.indexOf(range) + 1) * 100;
      const report = usageReport(range, tokens);
      report.summary.reasoning_output_tokens = tokens / 10;
      report.summary.estimated_cost_usd = tokens / 100;
      report.breakdown.models = [{ id: `model-${range}`, request_count: 1, input_tokens: tokens, output_tokens: 0, total_tokens: tokens, estimated_cost_usd: tokens / 100 }];
      report.timeseries = [{ date: "2026-10-28T00:00:00Z", ...report.breakdown.models[0] }];
      return Response.json(report);
    });
    vi.stubGlobal("fetch", fetch);
    render(<UsageView api={api} data={data} user={{ ...member, role }} />);

    for (const [index, label] of ["今日", "7 天", "30 天", "全部"].entries()) {
      if (index) fireEvent.click(screen.getByRole("button", { name: label }));
      expect(await screen.findByRole("cell", { name: `model-${ranges[index]}` })).toBeInTheDocument();
      const tokens = (index + 1) * 100;
      expect(within(screen.getByRole("group", { name: "Token 消耗" })).getByText(String(tokens))).toBeInTheDocument();
      expect(within(screen.getByRole("group", { name: "推理 Token" })).getByText(String(tokens / 10))).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Token 用量趋势" })).toBeInTheDocument();
      const trend = screen.getByRole("button", { name: new RegExp(`输入 ${tokens}，输出 0，请求 1`) });
      expect(trend).toBeInTheDocument();
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByText("111")).not.toBeInTheDocument();
      expect(screen.queryByText("222")).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "当天用量" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(ranges.map(range => `/api/backend/api/admin/usage/report?range=${range}`));
  });

  it.each(["admin", "team_leader", "user", "guest"])("preserves attribution permissions for %s even when the response includes restricted rows", async role => {
    const report = usageReport("today", 100);
    const row = { id: "restricted", request_count: 1, input_tokens: 100, output_tokens: 0, total_tokens: 100, estimated_cost_usd: 1 };
    report.breakdown.members = [{ ...row, id: "private-member" }];
    report.breakdown.providers = [{ ...row, id: "private-provider" }];
    report.breakdown.provider_resources = [{ ...row, id: "private-resource" }];
    report.breakdown.cost_centers = [{ ...row, id: "private-cost-center" }];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(report)));
    render(<UsageView api={api} data={emptyData()} user={{ ...member, role }} />);
    await screen.findByRole("heading", { name: "模型用量" });

    expect(Boolean(screen.queryByRole("heading", { name: "成员用量" }))).toBe(role === "team_leader");
    expect(Boolean(screen.queryByRole("heading", { name: "供应商用量" }))).toBe(role === "admin");
    expect(Boolean(screen.queryByRole("heading", { name: "资源账号用量" }))).toBe(role === "admin");
    expect(Boolean(screen.queryByRole("heading", { name: "成本中心用量" }))).toBe(["admin", "team_leader"].includes(role));
    expect(Boolean(screen.queryByText("部门与成员报告"))).toBe(role === "admin");
    expect(screen.getByRole("heading", { name: "API Key 用量" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Token 类型" })).toBeInTheDocument();
  });

  it("shows report errors and retries the selected period without presenting zero usage", async () => {
    let todayAttempts = 0;
    const fetch = vi.fn(async () => {
      todayAttempts += 1;
      return todayAttempts === 1
        ? new Response(JSON.stringify({ error: { message: "Synthetic report unavailable" } }), { status: 503 })
        : new Response(JSON.stringify(usageReport("today", 321)));
    });
    vi.stubGlobal("fetch", fetch);
    render(<UsageView api={api} data={emptyData()} user={member} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic report unavailable");
    expect(screen.queryByRole("group", { name: "Token 消耗" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "Token 用量趋势" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Token 消耗" })).getByText("321")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(todayAttempts).toBe(2);
  });

  it("refreshes the selected period every 30 seconds and stops when leaving the page", async () => {
    vi.useFakeTimers();
    let todayTokens = 321;
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>().mockImplementation(async () => Response.json(usageReport("today", todayTokens)));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<UsageView api={api} data={emptyData()} user={member} />);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("321", { selector: "strong" })).toBeInTheDocument();

    todayTokens = 400;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("400", { selector: "strong" })).toBeInTheDocument();

    unmount();
    expect(fetch.mock.calls.every(([, init]) => init.signal?.aborted)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a previous account's reports after switching sessions", async () => {
    let resolveOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>(resolve => { resolveOld = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
      if (new Headers(init.headers).get("authorization") === "Bearer old-session") return oldResponse.then(response => response.clone());
      return new Response(JSON.stringify(usageReport(input.endsWith("range=all") ? "all" : "today", 432)));
    }));
    const data = emptyData();
    const { rerender } = render(<UsageView api={{ ...api, adminToken: "old-session" }} data={data} user={member} />);
    rerender(<UsageView api={{ ...api, adminToken: "new-session" }} data={data} user={{ ...member, id: "another-member" }} />);
    await screen.findByRole("heading", { name: "Token 用量趋势" });
    await act(async () => { resolveOld(new Response(JSON.stringify(usageReport("today", 789)))); });
    expect(screen.queryByText("789")).not.toBeInTheDocument();
    expect(screen.getAllByText("432", { selector: "strong" })).toHaveLength(1);
  });
});

describe("DailyUsageSection", () => {
  it("shows mutually exclusive daily token type rows", () => {
    const data = emptyData();
    const report = usageReport("today");
    report.summary = {
      ...report.summary,
      input_tokens: 100,
      cached_input_tokens: 20,
      cache_write_input_tokens: 5,
      output_tokens: 50,
      total_tokens: 150,
    };

    render(<DailyUsageSection data={data} report={report} user={{ id: "usr_admin", username: "admin", name: "Admin", email: "admin@example.test", role: "admin", status: "active" }} />);

    const table = screen.getByRole("heading", { name: "今日 Token 类型" }).closest("article");
    expect(table).not.toBeNull();
    expect(within(table as HTMLElement).getByRole("row", { name: "输入 75" })).toBeInTheDocument();
    expect(within(table as HTMLElement).getByRole("row", { name: "缓存读 20" })).toBeInTheDocument();
    expect(within(table as HTMLElement).getByRole("row", { name: "缓存写 5" })).toBeInTheDocument();
    expect(within(table as HTMLElement).getByRole("row", { name: "输出 50" })).toBeInTheDocument();
  });

  it("hides provider daily breakdowns from team leaders", () => {
    const data = emptyData();
    const report = usageReport("today");
    report.breakdown.providers = [{
      id: "provider_sensitive",
      request_count: 1,
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      total_tokens: 15,
      estimated_cost_usd: 12.34,
    }];
    report.breakdown.provider_resources = [{
      id: "resource_sensitive",
      request_count: 1,
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      total_tokens: 15,
      estimated_cost_usd: 12.34,
    }];

    render(<DailyUsageSection data={data} report={report} user={{ id: "usr_leader", username: "leader", name: "Leader", email: "leader@example.test", role: "team_leader", status: "active" }} />);

    expect(screen.queryByRole("heading", { name: "今日 Provider 用量" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今日资源账号用量" })).not.toBeInTheDocument();
    expect(screen.queryByText("provider_sensitive")).not.toBeInTheDocument();
    expect(screen.queryByText("resource_sensitive")).not.toBeInTheDocument();
  });
});
