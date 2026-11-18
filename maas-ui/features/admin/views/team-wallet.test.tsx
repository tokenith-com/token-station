import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyData } from "../domain/catalog";
import { UsageView } from "./usage-billing";
import { TeamWalletSummary } from "./team-wallet";

const api = { baseURL: "http://example.test", adminToken: "synthetic-session" };
const wallet = { wallet: { team_id: "team/demo", balance_micros: 123_450_000, updated_at: "2026-11-14T00:00:00Z" }, currency: "USD", paid_calls_enabled: false };

describe("Team wallet summary", () => {
  it("reads only the leader's wallet and shows the USD balance without promising paid calls", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(wallet));
    vi.stubGlobal("fetch", fetch);
    render(<TeamWalletSummary api={api} teamID="team/demo" />);
    const section = screen.getByRole("region", { name: "团队钱包" });
    expect(await within(section).findByText("结算配置未完成，请联系管理员")).toBeInTheDocument();
    expect(section).toHaveTextContent("123.45");
    expect(fetch.mock.calls[0][0]).toBe("/api/backend/api/admin/teams/team%2Fdemo/wallet");
    expect(fetch.mock.calls[0][1].headers.get("authorization")).toBe("Bearer synthetic-session");
    expect(screen.queryByRole("button", { name: /充值/ })).not.toBeInTheDocument();
  });

  it.each([false, true])("reads the platform exchange rate with configured=%s", async configured => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ configured, usd_to_cny: configured ? "7.2" : "", paid_calls_enabled: false }));
    vi.stubGlobal("fetch", fetch);
    render(<TeamWalletSummary api={api} />);
    expect(await screen.findByText(configured ? "钱包汇率：1 USD = 7.2 CNY" : "钱包汇率未配置")).toBeInTheDocument();
    expect(fetch.mock.calls[0][0]).toBe("/api/backend/api/admin/team-wallet/exchange-rate");
  });

  it("does not turn loading or request failures into a zero balance and supports retry", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "Unavailable" } }, { status: 503 })).mockResolvedValueOnce(Response.json({ ...wallet, wallet: { ...wallet.wallet, balance_micros: 0 } }));
    vi.stubGlobal("fetch", fetch);
    render(<TeamWalletSummary api={api} teamID="team/demo" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载团队钱包…");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    expect(screen.queryByText("团队余额（USD）")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("团队余额（USD）")).toHaveTextContent("0.00");
  });

  it("does not request any wallet when the leader has no team", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<TeamWalletSummary api={api} teamID="" />);
    expect(screen.getByText("未关联团队，无法读取钱包")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits the leader's read-only ledger to their own team", async () => {
    const data = emptyData();
    const fetch = vi.fn().mockImplementation(async (path: string) => Response.json(path.includes("/ledger?") ? { entries: [], total: 0, limit: 20, offset: 0, currency: "USD" } : path.includes("/wallet") ? wallet : { range: "today", timezone: "UTC", window_start: "", window_end: "", granularity: "day", summary: data.summary, breakdown: data.breakdown, timeseries: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<UsageView api={api} data={data} user={{ id: "leader", name: "Leader", username: "leader", email: "leader@example.test", role: "team_leader", status: "active", team_id: "team/demo" }} />);
    const ledger = screen.getByRole("region", { name: "资金流水" });
    expect(await within(ledger).findByText("暂无资金流水")).toBeInTheDocument();
    expect(fetch.mock.calls.map(([path]) => path).filter(path => path.includes("/ledger?"))).toEqual(["/api/backend/api/admin/teams/team%2Fdemo/wallet/ledger?limit=20&offset=0"]);
    expect(screen.queryByRole("button", { name: "入账" })).not.toBeInTheDocument();
  });

  it("does not request a ledger for a leader without a team", async () => {
    const data = emptyData();
    const fetch = vi.fn().mockResolvedValue(Response.json({ range: "today", timezone: "UTC", window_start: "", window_end: "", granularity: "day", summary: data.summary, breakdown: data.breakdown, timeseries: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<UsageView api={api} data={data} user={{ id: "leader", name: "Leader", username: "leader", email: "leader@example.test", role: "team_leader", status: "active" }} />);
    expect(within(screen.getByRole("region", { name: "资金流水" })).getByText("未关联团队，无法读取钱包")).toBeInTheDocument();
    await screen.findByRole("group", { name: "请求数" });
    expect(fetch.mock.calls.map(([path]) => path).some(path => path.includes("/wallet"))).toBe(false);
  });

  it.each(["user", "guest"])("does not expose wallet reads to %s", async role => {
    const data = emptyData();
    const fetch = vi.fn().mockResolvedValue(Response.json({ range: "today", timezone: "UTC", window_start: "", window_end: "", granularity: "day", summary: data.summary, breakdown: data.breakdown, timeseries: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<UsageView api={api} data={data} user={{ id: "member", name: "Member", username: "member", email: "member@example.test", role, status: "active" }} />);
    await screen.findByRole("group", { name: "请求数" });
    expect(screen.queryByRole("region", { name: "团队钱包" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(["/api/backend/api/admin/usage/report?range=today"]);
  });
});
