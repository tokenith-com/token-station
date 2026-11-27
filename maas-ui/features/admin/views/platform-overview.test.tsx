import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { AdminUser, AppData } from "../core/types";
import { emptyData } from "../domain/catalog";
import { PlatformOverviewContent } from "./platform-overview";

const member: AdminUser = { id: "member", username: "member-login", name: "成员姓名", description: "账号备注", email: "member@example.test", role: "user", team_id: "engineering", team_ids: ["engineering", "support"], status: "active" };
const api = { baseURL: "https://backend.example", adminToken: "test-token" };

function usageReport(data: AppData) {
  return { range: "all", timezone: "UTC", window_start: "2026-01-01T00:00:00Z", window_end: "2026-11-03T00:00:00Z", granularity: "day", summary: data.summary, breakdown: data.breakdown, timeseries: data.timeseries };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

it("uses the all-time usage report for ranking metrics and shares instead of overview breakdowns", async () => {
  const data = emptyData();
  data.users = [member];
  data.resources.teams = [
    { id: "engineering", kind: "teams", name: "研发部", status: "active" },
    { id: "support", kind: "teams", name: "支持部", status: "active" },
  ];
  data.summary.total_tokens = 1;
  data.summary.estimated_cost_usd = 3.25;
  const allData = emptyData();
  allData.summary.total_tokens = 4000;
  allData.breakdown.members = [{ id: member.id, request_count: 12, input_tokens: 1000, cached_input_tokens: 250, output_tokens: 200, total_tokens: 1200, estimated_cost_usd: 2.5, used_key_count: 2, owned_key_count: 5 }];
  const fetcher = vi.fn().mockResolvedValue(Response.json(usageReport(allData)));
  vi.stubGlobal("fetch", fetcher);
  render(<PlatformOverviewContent api={api} data={data} />);

  const table = await screen.findByRole("table");
  expect(screen.getByText("总成本").closest("article")).toHaveTextContent("$3.25");
  await userEvent.setup().click(screen.getByRole("tab", { name: /^成本$/ }));
  expect(screen.getByRole("img")).toHaveTextContent("$");
  expect(screen.getByRole("img")).not.toHaveTextContent("¥");
  expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/api\/admin\/usage\/report\?range=all$/), expect.anything());
  expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
    "排名", "成员", "客户团队", "Key（已用/归属）", "请求", "输入 token", "缓存读", "缓存命中率", "输出 token", "总 token", "占比", "成本",
  ]);
  expect(within(table).getAllByRole("cell").map(cell => cell.textContent)).toEqual([
    "1", "成员姓名", "研发部", "2 / 5", "12", "1,000", "250", "25.0%", "200", "1,200", "30%", "$2.50",
  ]);
  expect(screen.queryByText("账号备注")).not.toBeInTheDocument();
});

it("matches master's member filtering and identity resolution while retaining share sorting", async () => {
  const data = emptyData();
  data.users = [{ ...member, id: "idle", username: "idle", email: "idle@example.test", name: "无用量成员" }, { ...member, id: "active", name: "活跃成员" }];
  data.summary.total_tokens = 10000;
  const usage = { request_count: 1, input_tokens: 0, cached_input_tokens: 10, output_tokens: 100, total_tokens: 100, estimated_cost_usd: 0 };
  data.breakdown.members = [
    { ...usage, id: "idle", request_count: 0, output_tokens: 0, total_tokens: 0 },
    { ...usage, id: member.email },
    { ...usage, id: "archived-member", output_tokens: 50, total_tokens: 50 },
  ];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(usageReport(data))));
  render(<PlatformOverviewContent api={api} data={data} />);

  const table = await screen.findByRole("table");
  let rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(within(table).queryByText("无用量成员")).not.toBeInTheDocument();
  expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("活跃成员");
  expect(within(rows[1]).getAllByRole("cell")[7]).toHaveTextContent("0%");
  await userEvent.setup().click(screen.getByRole("button", { name: "占比" }));
  rows = within(table).getAllByRole("row");
  expect(within(rows[1]).getAllByRole("cell").map(cell => cell.textContent)).toEqual([
    "1", "archived-member", "未归属客户团队", "0 / 0", "1", "0", "10", "0%", "50", "50", "0.5%", "$0.000000",
  ]);
});

it("shows report failures and retries instead of falling back to unrelated overview usage", async () => {
  const data = emptyData();
  data.users = [member];
  data.breakdown.members = [{ id: member.id, request_count: 1, input_tokens: 100, output_tokens: 0, total_tokens: 100, estimated_cost_usd: 0 }];
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({}, { status: 500 }))
    .mockResolvedValueOnce(Response.json(usageReport(emptyData())));
  vi.stubGlobal("fetch", fetcher);
  render(<PlatformOverviewContent api={api} data={data} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("用量统计加载失败");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("暂无用户用量数据")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
