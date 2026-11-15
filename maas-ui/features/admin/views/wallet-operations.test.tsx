import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WalletOperations } from "./wallet-operations";
import { setActiveLanguage } from "../i18n/runtime";

beforeEach(() => setActiveLanguage("zh-CN"));
it("loads older orders for reconciliation beyond the API's first page", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("payment-wallet/usage")) return Response.json({ data: [] });
    if (url.endsWith("payment-orders?offset=50")) return Response.json({ data: [{ order_no: "older-order", amount_fen: 1000, channel: "alipay", status: "succeeded" }] });
    if (url.endsWith("payment-orders")) return Response.json({ data: Array.from({ length: 50 }, (_, i) => ({ order_no: `recent-${i}`, amount_fen: 100, channel: "alipay", status: "pending" })) });
    throw new Error("Undeclared request: " + url);
  }));
  render(<WalletOperations api={{ baseURL: "https://fixture.invalid", adminToken: "synthetic" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "加载更早记录" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "加载更早记录" })).not.toBeInTheDocument());
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "older-order" } });
  expect(screen.getByText("older-order")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "申请全额退款" })).toBeEnabled();
});
