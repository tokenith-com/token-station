import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletLedger } from "./wallet-ledger";

afterEach(() => vi.unstubAllGlobals());

it("keeps the loaded ledger when the selected page size does not change", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ currency: "USD", entries: [], total: 0 }));
  vi.stubGlobal("fetch", fetch);
  render(<WalletLedger api={{ baseURL: "/", adminToken: "fixture" }} teamID="fixture-team" copy={{ tx: key => key, locale: "en-US" }} />);
  await screen.findByText("暂无资金流水");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "20" } });
  expect(screen.getByText("暂无资金流水")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
