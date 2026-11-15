import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RechargeSettings } from "./recharge-settings";

it("loads and persists plans and custom limits in integer cents", async () => {
  const initial = { plans: [{ id: "ten", name: "Ten", amount_fen: 1000, disabled: false }], custom_enabled: false, min_fen: 100, max_fen: 100000 };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === "PUT" ? JSON.parse(String(init.body)) : initial));
  vi.stubGlobal("fetch", fetch);
  render(<RechargeSettings api={{ baseURL: "http://example.test", adminToken: "synthetic-session" }} />);
  fireEvent.click(screen.getByRole("button", { name: "配置充值档位" }));
  fireEvent.click(await screen.findByLabelText("允许自定义充值金额"));
  fireEvent.change(screen.getByLabelText("最低金额（元）"), { target: { value: "1.23" } });
  fireEvent.click(screen.getByLabelText("启用"));
  fireEvent.click(screen.getByRole("button", { name: "保存充值设置" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("充值设置已保存"));
  const saved = JSON.parse(String(fetch.mock.calls.find(([,init]) => init?.method === "PUT")?.[1]?.body));
  expect(saved.min_fen).toBe(123);
  expect(saved.custom_enabled).toBe(true);
  expect(saved.plans[0].disabled).toBe(true);
});
