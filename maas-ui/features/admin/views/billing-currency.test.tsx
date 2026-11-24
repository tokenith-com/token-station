import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statementCurrencyStorageKey } from "../domain/billing-currency";
import { setActiveLanguage } from "../i18n/runtime";
import { BillingStatements } from "./billing-statements";
import { emptyData } from "../domain/catalog";
import { ModalErrorProvider } from "../shared/modal-error";
import { ReconciliationManager } from "./billing-reconciliation";
import { ReconciliationManager as SourceReconciliationManager } from "../legacy-source/views/billing-reconciliation";
import { setActiveLanguage as setSourceLanguage } from "../legacy-source/i18n/runtime";

const api = { baseURL: "", adminToken: "test" };
beforeEach(() => { setActiveLanguage("zh-CN"); window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mockStatements() {
  const fetch = vi.fn().mockImplementation((_url, options) => {
    if (!options?.body) return Promise.resolve(new Response(JSON.stringify({ data: [] })));
    const query = JSON.parse(options.body);
    return Promise.resolve(new Response(JSON.stringify({ query, generated_at: "2020-02-02T00:00:00Z", from: "2020-01-01T00:00:00Z", to: "2020-02-01T00:00:00Z", time_basis: "upstream_attempt_start", rows: [{ id: "known", source: "provider_billed", at: "2020-01-02T00:00:00Z", timezone: "UTC", model: "sample", currency: "USD", amount: "2", usd: "2", display_amount: "14.5", units: {}, status: "provider_billed" }, { id: "unknown", source: "provider_estimate", at: "2020-01-02T00:00:00Z", timezone: "UTC", model: "sample", currency: "USD", amount: null, usd: null, display_amount: null, units: {}, status: "pending" }], totals: { "provider_billed:USD": "2" }, unknown_count: 1, incomplete_count: 1, estimated_margin_usd: null, conversion: { currency: "JPY", usd_exchange_rate: "7.25" }, display_totals: { provider_billed: "14.5" } })));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function submit() { fireEvent.submit(screen.getByRole("button", { name: "预览对账单" }).closest("form")!); }

describe.each([["admin", ReconciliationManager], ["source-admin", SourceReconciliationManager]] as const)("%s reconciliation currency", (_name, Manager) => {
  function renderManager(onError = vi.fn()) {
    setSourceLanguage("zh-CN");
    const data = emptyData();
    data.billingConnectors = [{ id: "connector", name: "Synthetic connector", type: "newapi", base_url: "https://example.test", status: "active", schedule_interval_minutes: 0, credentials_configured: true, created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" }];
    render(<ModalErrorProvider onError={onError}><Manager api={api} data={data} loading={false} onReload={vi.fn().mockResolvedValue(undefined)} /></ModalErrorProvider>);
    fireEvent.click(screen.getByRole("button", { name: "新增对账规则" }));
  }

  it("submits the backend USD default with rate one", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetch);
    renderManager();
    expect(screen.getByPlaceholderText("USD")).toHaveValue("USD");
    expect(screen.getByLabelText("USD 汇率（1 USD = 目标币种）")).toHaveValue("1");
    fireEvent.submit(screen.getByRole("button", { name: "保存" }).closest("form")!);
    await screen.findByText("对账规则已保存");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ currency: "USD", usd_exchange_rate: "1" });
  });

  it("labels exchange rate errors in the USD basis and preserves explicit CNY input", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: "invalid_reconciliation_exchange_rate" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const onError = vi.fn();
    renderManager(onError);
    fireEvent.change(screen.getByPlaceholderText("USD"), { target: { value: "CNY" } });
    fireEvent.change(screen.getByLabelText("USD 汇率（1 USD = 目标币种）"), { target: { value: "7.25" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存" }).closest("form")!);
    if (_name === "admin") await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "USD 汇率必须是有效的正数" }), "保存失败"));
    else expect(await screen.findByRole("alert")).toHaveTextContent("USD 汇率必须是有效的正数");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ currency: "CNY", usd_exchange_rate: "7.25" });
  });
});

describe("Statement currency preferences", () => {
  it("defaults to USD without a manual input and always submits rate one", async () => {
    const fetch = mockStatements();
    window.localStorage.setItem(statementCurrencyStorageKey, JSON.stringify({ currency: "USD", rates: { USD: "7.25" } }));
    render(<BillingStatements api={api} side="provider" />);
    expect(screen.getByLabelText("对账单币种")).toHaveValue("USD");
    expect(screen.queryByLabelText("手动汇率：1 USD 兑目标币种")).not.toBeInTheDocument();
    submit();
    await screen.findByRole("button", { name: "导出当前预览 CSV" });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ display_currency: "USD", display_exchange_rate: "1" });
  });
  it.each(["CNY", "JPY", "RUB"])("requires a positive exact manual rate for %s before requesting conversion", async currency => {
    const fetch = mockStatements();
    render(<BillingStatements api={api} side="provider" />);
    fireEvent.change(screen.getByLabelText("对账单币种"), { target: { value: currency } });
    for (const value of ["", "0", "-1", "1e2"]) {
      fireEvent.change(screen.getByLabelText("手动汇率：1 USD 兑目标币种"), { target: { value } });
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent("请输入大于 0 的手动汇率");
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows original and converted amounts, preserves unknowns, and invalidates edited previews", async () => {
    const fetch = mockStatements();
    render(<BillingStatements api={api} side="provider" />);
    fireEvent.change(screen.getByLabelText("对账单币种"), { target: { value: "JPY" } });
    fireEvent.change(screen.getByLabelText("手动汇率：1 USD 兑目标币种"), { target: { value: "7.25" } });
    submit();
    await screen.findByRole("button", { name: "导出当前预览 CSV" });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ display_currency: "JPY", display_exchange_rate: "7.25" });
    expect(screen.getByText("US$2.00", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("换算金额：JP¥14.50")).toBeInTheDocument();
    expect(screen.getByText("换算金额：未知")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("手动汇率：1 USD 兑目标币种"), { target: { value: "7.5" } });
    expect(screen.queryByRole("button", { name: "导出当前预览 CSV" })).not.toBeInTheDocument();
    submit();
    await screen.findByRole("button", { name: "导出当前预览 CSV" });
    fireEvent.change(screen.getByLabelText("对账单币种"), { target: { value: "RUB" } });
    expect(screen.queryByRole("button", { name: "导出当前预览 CSV" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("手动汇率：1 USD 兑目标币种")).toHaveValue("");
  });

  it("restores browser currency and per-currency rates across mounts", () => {
    mockStatements();
    const first = render(<BillingStatements api={api} side="provider" />);
    fireEvent.change(screen.getByLabelText("对账单币种"), { target: { value: "JPY" } });
    fireEvent.change(screen.getByLabelText("手动汇率：1 USD 兑目标币种"), { target: { value: "7.25" } });
    fireEvent.change(screen.getByLabelText("对账单币种"), { target: { value: "RUB" } });
    fireEvent.change(screen.getByLabelText("手动汇率：1 USD 兑目标币种"), { target: { value: "150" } });
    first.unmount();
    render(<BillingStatements api={api} side="provider" />);
    expect(screen.getByLabelText("对账单币种")).toHaveValue("RUB");
    expect(screen.getByLabelText("手动汇率：1 USD 兑目标币种")).toHaveValue("150");
    fireEvent.change(screen.getByLabelText("对账单币种"), { target: { value: "JPY" } });
    expect(screen.getByLabelText("手动汇率：1 USD 兑目标币种")).toHaveValue("7.25");
    expect(JSON.parse(window.localStorage.getItem(statementCurrencyStorageKey)!)).toEqual({ currency: "JPY", rates: { JPY: "7.25", RUB: "150" } });
  });

  it("preserves another form's saved rate when selecting and editing a different currency", () => {
    mockStatements();
    window.localStorage.setItem(statementCurrencyStorageKey, JSON.stringify({ currency: "JPY", rates: { JPY: "7.1", RUB: "150" } }));
    const first = render(<BillingStatements api={api} side="provider" />);
    const second = render(<BillingStatements api={api} side="provider" />);
    const firstForm = within(first.container), secondForm = within(second.container);
    fireEvent.change(firstForm.getByLabelText("手动汇率：1 USD 兑目标币种"), { target: { value: "7.3" } });
    expect(JSON.parse(window.localStorage.getItem(statementCurrencyStorageKey)!).rates.JPY).toBe("7.3");
    fireEvent.change(secondForm.getByLabelText("对账单币种"), { target: { value: "RUB" } });
    expect(JSON.parse(window.localStorage.getItem(statementCurrencyStorageKey)!).rates.JPY).toBe("7.3");
    fireEvent.change(secondForm.getByLabelText("手动汇率：1 USD 兑目标币种"), { target: { value: "151" } });
    expect(JSON.parse(window.localStorage.getItem(statementCurrencyStorageKey)!)).toEqual({ currency: "RUB", rates: { JPY: "7.3", RUB: "151" } });
    first.unmount(); second.unmount();
    render(<BillingStatements api={api} side="provider" />);
    expect(screen.getByLabelText("手动汇率：1 USD 兑目标币种")).toHaveValue("151");
    fireEvent.change(screen.getByLabelText("对账单币种"), { target: { value: "JPY" } });
    expect(screen.getByLabelText("手动汇率：1 USD 兑目标币种")).toHaveValue("7.3");
  });

  it("submits and persists the locale decimal separator without losing precision", async () => {
    setActiveLanguage("ru");
    const fetch = mockStatements();
    render(<BillingStatements api={api} side="provider" />);
    fireEvent.change(screen.getByLabelText("Валюта выписки"), { target: { value: "JPY" } });
    fireEvent.change(screen.getByLabelText("Ручной курс: единиц целевой валюты за 1 USD"), { target: { value: "7,250000000001" } });
    fireEvent.submit(screen.getByRole("button", { name: "Предпросмотр акта сверки" }).closest("form")!);
    await screen.findByRole("button", { name: "Экспорт текущего предпросмотра в CSV" });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ display_currency: "JPY", display_exchange_rate: "7.250000000001" });
    expect(JSON.parse(window.localStorage.getItem(statementCurrencyStorageKey)!)).toEqual({ currency: "JPY", rates: { JPY: "7.250000000001" } });
  });
});
