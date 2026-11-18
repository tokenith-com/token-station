import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { walletTranslations } from "../i18n/wallet";
import { setActiveLanguage as setAdminLanguage, tx as adminTx } from "../i18n/runtime";
import { setActiveLanguage as setSourceLanguage, tx as sourceTx } from "../../source-admin/i18n/runtime";
import { WalletCreditDialog } from "./wallet-credit-dialog";
import { WalletLedger } from "./wallet-ledger";
import { loadWalletBalance, pendingWalletKey, WalletReadError, yuanToMicros } from "./wallet-contract";

const api = { baseURL: "http://example.test", adminToken: "synthetic-session" };
const copy = { tx: (key: string) => key, locale: "en-US" };
const props = { api, userID: "admin", teamID: "team/demo", teamName: "Demo", owner: "Owner", balance: 100, copy, onClose: vi.fn(), onSaved: vi.fn() };
function fill() {
  fireEvent.change(screen.getByLabelText("入账金额（元）"), { target: { value: "12.34" } });
  fireEvent.change(screen.getByLabelText("备注（必填，最多1000字）"), { target: { value: "Receipt 42" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
describe("Wallet credit confirmation", () => {
  beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
  it.each(["0", "-1", "1.0000001", "1e3", "NaN", "90071992547409.92", "", " 1"])("rejects unsafe amount %s", value => { expect(yuanToMicros(value)).toBeUndefined(); });
  it("converts decimal strings without floating point rounding", () => { expect(yuanToMicros("12.34")).toBe(12_340_000); expect(yuanToMicros("0.000001")).toBe(1); expect(yuanToMicros("9007199254.740991")).toBe(Number.MAX_SAFE_INTEGER); });
  it("requires explicit confirmation and sends exact micros", async () => {
    const fetch = vi.fn().mockImplementation(async (_url, init) => { const payload = JSON.parse(init.body); return Response.json({ currency: "CNY", entry: { ...payload, team_id: props.teamID, actor_user_id: "admin" } }); });
    vi.stubGlobal("fetch", fetch);
    render(<WalletCreditDialog {...props} />);
    expect(screen.getByRole("button", { name: "确认入账" })).toBeDisabled();
    fill(); fireEvent.click(screen.getByRole("button", { name: "确认入账" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ amount_micros: 12_340_000, credit_type: "offline_receipt", remark: "Receipt 42" });
    expect(sessionStorage.getItem(pendingWalletKey(api, "admin", props.teamID))).toBeNull();
  });
  it("restores an ambiguous operation and reconciles the same request after remount", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })); vi.stubGlobal("fetch", fetch);
    const view = render(<WalletCreditDialog {...props} />); fill(); fireEvent.click(screen.getByRole("button", { name: "确认入账" }));
    await screen.findByRole("button", { name: "使用原请求重试" });
    const payload = JSON.parse(sessionStorage.getItem(pendingWalletKey(api, "admin", props.teamID))!);
    view.unmount(); render(<WalletCreditDialog {...props} />);
    expect(screen.getByLabelText("入账金额（元）")).toBeDisabled();
    fetch.mockResolvedValueOnce(Response.json({ currency: "CNY", total: 1, limit: 20, offset: 0, entries: [{ ...payload, kind: "credit", team_id: props.teamID, actor_user_id: "admin" }] }));
    fireEvent.click(screen.getByRole("button", { name: "使用原请求重试" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain(`request_id=${payload.request_id}`);
  });
  it("retries a failed operation with the original UUID and locked payload", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(Response.json({ currency: "CNY", entries: [], total: 0 })).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    render(<WalletCreditDialog {...props} />); fill(); fireEvent.click(screen.getByRole("button", { name: "确认入账" }));
    await screen.findByRole("button", { name: "使用原请求重试" });
    fireEvent.click(screen.getByRole("button", { name: "使用原请求重试" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[0][1].body);
    await waitFor(() => expect(screen.getByRole("button", { name: "使用原请求重试" })).not.toBeDisabled());
    expect(screen.getByLabelText("入账金额（元）")).toBeDisabled();
  });
  it("scopes pending operations by API base, operator, and team", () => {
    const key = pendingWalletKey(api, "other-admin", props.teamID);
    sessionStorage.setItem(key, JSON.stringify({ amount_micros: 5_000_000, request_id: "other-operation", credit_type: "approved_credit", remark: "Other operator" }));
    render(<WalletCreditDialog {...props} />);
    expect(screen.getByLabelText("入账金额（元）")).toHaveValue("");
    expect(screen.getByLabelText("入账金额（元）")).not.toBeDisabled();
    expect(pendingWalletKey({ ...api, baseURL: "http://another.test" }, "other-admin", props.teamID)).not.toBe(key);
    expect(pendingWalletKey(api, "other-admin", "another-team")).not.toBe(key);
    expect(sessionStorage.getItem(key)).toContain("other-operation");
  });
  it.each(["broken", "", "null", '{"amount_micros":100,"request_id":7,"credit_type":"offline_receipt","remark":"Receipt"}'])("retains malformed pending session data on retry: %s", raw => {
    const key = pendingWalletKey(api, "admin", props.teamID); sessionStorage.setItem(key, raw);
    render(<WalletCreditDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "重新读取待确认操作" }));
    expect(screen.getByRole("button", { name: "确认入账" })).toBeDisabled(); expect(sessionStorage.getItem(key)).toBe(raw);
  });
  it.each([false, true])("recovers a transient storage read failure with pending=%s", hasPending => {
    const payload = { amount_micros: 5_000_000, request_id: "original-uuid", credit_type: "approved_credit", remark: "Receipt" };
    const key = pendingWalletKey(api, "admin", props.teamID);
    if (hasPending) sessionStorage.setItem(key, JSON.stringify(payload));
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
    render(<WalletCreditDialog {...props} />);
    expect(screen.getByRole("button", { name: "确认入账" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新读取待确认操作" }));
    if (hasPending) {
      expect(screen.getByRole("button", { name: "使用原请求重试" })).toBeEnabled();
      expect(screen.getByLabelText("入账金额（元）")).toHaveValue("5.00");
      expect(sessionStorage.getItem(key)).toBe(JSON.stringify(payload));
    } else { fill(); expect(screen.getByRole("button", { name: "确认入账" })).toBeEnabled(); }
    read.mockRestore();
  });
  it("requires loaded balance and explicit confirmation while accepting a zero balance", () => {
    const retry = vi.fn();
    const view = render(<WalletCreditDialog {...props} balance={undefined} balanceError onRetryBalance={retry} />);
    fill();
    expect(screen.getByText("请等待余额成功加载后再确认入账")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认入账" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "余额加载失败，重试" })); expect(retry).toHaveBeenCalledOnce();
    view.rerender(<WalletCreditDialog {...props} balance={0} />);
    expect(screen.getByRole("button", { name: "确认入账" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("请先勾选核实收款或授信信息")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认入账" })).toBeDisabled();
  });
  it("explains invalid remarks and projected overflow", () => {
    const view = render(<WalletCreditDialog {...props} />); fill();
    fireEvent.change(screen.getByLabelText("备注（必填，最多1000字）"), { target: { value: " " } });
    expect(screen.getByText("请填写非空备注，最多1000字")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("备注（必填，最多1000字）"), { target: { value: "x".repeat(1001) } });
    expect(screen.getByRole("button", { name: "确认入账" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("备注（必填，最多1000字）"), { target: { value: "Receipt" } });
    view.rerender(<WalletCreditDialog {...props} balance={Number.MAX_SAFE_INTEGER} />);
    expect(screen.getByText("预计余额超出安全范围，请减少入账金额")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认入账" })).toBeDisabled();
  });
});
describe("Wallet translations", () => {
  it.each(["en", "ja"] as const)("registers every wallet key in both %s runtimes", language => {
    setAdminLanguage(language); setSourceLanguage(language);
    try {
      for (const key of Object.keys(walletTranslations[language])) {
        expect(adminTx(key)).not.toBe(key);
        expect(sourceTx(key)).not.toBe(key);
      }
    } finally { setAdminLanguage("zh-CN"); setSourceLanguage("zh-CN"); }
  });
});
describe("Wallet ledger lifecycle", () => {
  it.each([
    [403, "无权读取钱包，请联系管理员确认权限"],
    [404, "钱包接口不可用，请确认后端已升级并启用钱包功能"],
    [503, "钱包请求失败，请检查网络或稍后重试"],
    [0, "钱包请求失败，请检查网络或稍后重试"],
    [200, "钱包响应格式异常，请联系管理员检查服务版本"],
  ])("shows a safe category for status %s and retries without an empty fallback", async (status, message) => {
    const fetch = vi.fn().mockImplementationOnce(async () => {
      if (status === 0) throw new Error("secret upstream diagnostics");
      return Response.json({ error: "secret upstream diagnostics" }, { status: Number(status) });
    }).mockResolvedValueOnce(Response.json({ currency: "CNY", entries: [], total: 0 }));
    vi.stubGlobal("fetch", fetch); render(<WalletLedger api={api} teamID="demo" copy={copy} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(String(message));
    expect(screen.queryByText("暂无资金流水")).not.toBeInTheDocument();
    expect(screen.queryByText(/secret upstream/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("暂无资金流水")).toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])("distinguishes a missing team from an unregistered route: structured=%s", async structured => {
    const response = structured ? Response.json({ error: { code: "resource_not_found", message: "Internal details" } }, { status: 404 }) : new Response("404 page not found", { status: 404 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    render(<WalletLedger api={api} teamID="demo" copy={copy} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(structured ? "团队不存在或已删除，请刷新团队列表" : "钱包接口不可用，请确认后端已升级并启用钱包功能");
  });
  it.each([null, { currency: "CNY", entries: [null], total: 1 }, { currency: "CNY", entries: [{ created_at: "invalid" }], total: 1 }])("rejects malformed ledger data %j", async payload => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    render(<WalletLedger api={api} teamID="demo" copy={copy} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("钱包响应格式异常");
  });
  it.each([[403, "permission"], [404, "unavailable"], [500, "request"], [200, "malformed"]])("classifies balance reads for status %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: Number(status) })));
    await expect(loadWalletBalance(api, "demo")).rejects.toEqual(new WalletReadError(kind as "permission" | "unavailable" | "request" | "malformed"));
  });
  it("paginates with an explicit limit and offset", async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ currency: "CNY", total: 21, entries: [] })); vi.stubGlobal("fetch", fetch);
    render(<WalletLedger api={api} teamID="demo" copy={copy} />);
    await screen.findByText("暂无资金流水");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(fetch.mock.calls[1][0])).toContain("limit=20&offset=20");
    await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(String(fetch.mock.calls[2][0])).toContain("limit=20&offset=0");
  });
  it("separates held reservations from actual charged amounts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ currency: "CNY", total: 1, entries: [{ id: "call", request_id: "call", kind: "call", status: "reserved", amount_micros: -5_000_000, actual_amount_micros: 0, reserved_micros: 5_000_000, created_at: "2026-11-14T00:00:00Z" }] })));
    render(<WalletLedger api={api} teamID="demo" copy={copy} />);
    expect(await screen.findByText("预留中")).toBeInTheDocument(); expect(screen.getByText("CN¥0.00")).toBeInTheDocument(); expect(screen.getByText("CN¥5.00")).toBeInTheDocument();
  });
});
