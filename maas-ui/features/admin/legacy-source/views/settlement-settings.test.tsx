import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { enTranslations } from "../i18n/en";
import { jaTranslations } from "../i18n/ja";
import { setActiveLanguage } from "../i18n/runtime";
import { canAccessView } from "../../core/navigation";
import { authExpiredEventName, type AdminUser } from "../core/types";
import { SettlementSettingsView, validSettlementRate } from "./settlement-settings";

const api = { baseURL: "http://localhost:8080", adminToken: "synthetic-admin" };
const rate = (value = "7.2", configured = true) => new Response(JSON.stringify({ usd_to_cny: value, configured, paid_calls_enabled: configured }));

const historyResponse = (offset = 0, total = 0) => new Response(JSON.stringify({ entries: total ? [{ id: `history-${offset}`, usd_to_cny: "999999999999999999.123456", created_at: "2026-01-02T03:04:05Z", actor_user_id: "synthetic-actor", actor_name: offset ? "Earlier operator" : "Synthetic operator" }] : [], total, limit: 50, offset }));
function stubFetch(rateFetch: (url: string, init: RequestInit) => unknown, historyFetch = vi.fn().mockImplementation(() => Promise.resolve(historyResponse()))) {
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => url.includes("/history?") ? historyFetch(url, init) : rateFetch(url, init)));
}

describe("SettlementSettingsView", () => {
  beforeEach(() => setActiveLanguage("zh-CN"));
  it("provides English and Japanese translations for every literal settlement UI key", () => {
    const source = readFileSync("features/admin/legacy-source/views/settlement-settings.tsx", "utf8");
    for (const [, key] of source.matchAll(/tx\("([^"]+)"\)/g)) {
      expect(enTranslations[key], `Missing English key: ${key}`).toBeTruthy();
      expect(jaTranslations[key], `Missing Japanese key: ${key}`).toBeTruthy();
    }
  });
  it.each(["0.000001", "999999999999999999.123456", "1", "0001.20"])("accepts positive decimal %s without floating point conversion", value => {
    expect(validSettlementRate(value)).toBe(true);
  });

  it.each(["", "0", "0.000000", "-1", "+1", "1e2", ".1", "1.", "1.1234567", "1234567890123456789", " 7.2", "NaN"])("rejects invalid rate %s", value => {
    expect(validSettlementRate(value)).toBe(false);
  });

  it("keeps an unconfigured rate blank and validates the form", async () => {
    stubFetch(vi.fn().mockResolvedValue(rate("", false)));
    render(<SettlementSettingsView api={api} />);
    await screen.findByText("汇率未配置");
    const input = screen.getByRole("textbox", { name: "美元兑人民币汇率" });
    expect(input).toHaveValue("");
    const save = screen.getByRole("button", { name: "保存配置" });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "0" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "0.000001" } });
    expect(save).toBeEnabled();
  });

  it("saves the exact decimal string once and disables equivalent unchanged values", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce(rate()).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    stubFetch(fetchMock);
    const user = userEvent.setup();
    render(<SettlementSettingsView api={api} />);
    await screen.findByText("汇率已配置");
    const input = screen.getByRole("textbox", { name: "美元兑人民币汇率" });
    const save = screen.getByRole("button", { name: "保存配置" });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "007.200000" } });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "999999999999999999.123456" } });
    await user.click(save);
    expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${api.baseURL}/api/admin/team-wallet/exchange-rate`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ usd_to_cny: "999999999999999999.123456" });
    resolve(rate("999999999999999999.123456"));
    await screen.findByText("结算汇率已保存");
    expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
  });

  it("preserves input after a save failure and allows retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(rate()).mockResolvedValueOnce(new Response("", { status: 500 })).mockResolvedValueOnce(rate("7.123456"));
    stubFetch(fetchMock);
    const user = userEvent.setup();
    render(<SettlementSettingsView api={api} />);
    await screen.findByText("汇率已配置");
    const input = screen.getByRole("textbox", { name: "美元兑人民币汇率" });
    fireEvent.change(input, { target: { value: "7.123456" } });
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("结算汇率保存失败");
    expect(input).toHaveValue("7.123456");
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    await screen.findByText("结算汇率已保存");
  });

  it("retries a failed load and reports denied access without exposing a save action", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 403 })).mockResolvedValueOnce(rate());
    stubFetch(fetchMock);
    const user = userEvent.setup();
    render(<SettlementSettingsView api={api} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("汇率已配置");
    expect(screen.getByRole("textbox")).toHaveValue("7.2");
  });

  it("uses the existing expired-session event on 401", async () => {
    stubFetch(vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    const expired = vi.fn();
    window.addEventListener(authExpiredEventName, expired);
    render(<SettlementSettingsView api={api} />);
    await waitFor(() => expect(expired).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    window.removeEventListener(authExpiredEventName, expired);
  });

  it("loads history independently without inventing an initial record", async () => {
    let resolve!: (response: Response) => void;
    stubFetch(vi.fn().mockResolvedValue(rate()), vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    render(<SettlementSettingsView api={api} />);
    await screen.findByText("汇率已配置");
    expect(screen.getByRole("region", { name: "汇率保存历史" })).toHaveAttribute("aria-busy", "true");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "8" } });
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled();
    resolve(historyResponse());
    await screen.findByText("暂无汇率保存记录");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("历史从功能上线后的成功保存开始记录，既有缺失记录无法恢复。")).toBeVisible();
  });

  it("paginates exact rates and formats saved times using the selected locale and timezone", async () => {
    setActiveLanguage("en");
    const historyFetch = vi.fn((url: string) => Promise.resolve(historyResponse(Number(new URL(url).searchParams.get("offset")), 51)));
    stubFetch(vi.fn().mockResolvedValue(rate()), historyFetch);
    render(<SettlementSettingsView api={api} />);
    await screen.findByText("Synthetic operator");
    expect(screen.getByText("1 USD = 999999999999999999.123456 CNY")).toBeVisible();
    const expected = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date("2026-01-02T03:04:05Z"));
    expect(document.querySelector("time")).toHaveTextContent(expected);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Earlier operator");
    expect(historyFetch.mock.calls[1][0]).toContain("limit=50&offset=50");
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await screen.findByText("Synthetic operator");
  });

  it("refreshes page one after saving and separates history failures from save success", async () => {
    const historyFetch = vi.fn().mockResolvedValueOnce(historyResponse(0, 51)).mockResolvedValueOnce(historyResponse(50, 51)).mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(historyResponse(0, 52));
    stubFetch(vi.fn().mockResolvedValueOnce(rate()).mockResolvedValueOnce(rate("8.123456")), historyFetch);
    render(<SettlementSettingsView api={api} />);
    await screen.findByText("Synthetic operator");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("Earlier operator");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "8.123456" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await screen.findByText("结算汇率已保存");
    expect(await screen.findByRole("alert")).toHaveTextContent("汇率保存历史加载失败");
    expect(screen.getByRole("textbox")).toHaveValue("8.123456");
    expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
    expect(historyFetch.mock.calls[2][0]).toContain("offset=0");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("Synthetic operator");
    expect(screen.getByText("结算汇率已保存")).toBeVisible();
  });

  it.each(["admin", "security", "team_leader", "user"])("restricts settlement access for %s", role => {
    expect(canAccessView({ role } as AdminUser, "settlement-settings")).toBe(role === "admin");
  });
});
