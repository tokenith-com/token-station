import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RequestPayloadViewer } from "./request-payload-viewer";
import type { RequestPayloadLog } from "../core/types";

const payload: RequestPayloadLog = { id: "p", request_id: "r", created_at: "2026-11-26T00:00:00Z", request_truncated: false, response_truncated: false,
  request_body: JSON.stringify({ model: "fixture", stream: false, max_tokens: 0, tools: [{ function: { name: "fixture_tool" } }], extension: null }),
  response_body: JSON.stringify({ choices: [{ message: { content: "Synthetic response" } }], usage: { prompt_tokens: 10, completion_tokens: 0 } }),
};
afterEach(() => vi.unstubAllGlobals());
it("displays arbitrary parameters, zero and false without interpreting them as absent", () => {
  render(<RequestPayloadViewer payload={payload} />);
  fireEvent.click(screen.getByText("展开报文内容"));
  expect(screen.getByText("max_tokens")).toBeInTheDocument();
  expect(screen.getByText("false")).toBeInTheDocument();
  expect(screen.getByText("max_tokens").parentElement).toHaveTextContent("0");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "fixture_tool" } });
  expect(screen.getByText('"fixture_tool"')).toBeVisible();
  expect(screen.queryByText("max_tokens")).not.toBeInTheDocument();
});
it("switches response content and exposes real raw usage", () => {
  render(<RequestPayloadViewer payload={payload} />);
  fireEvent.click(screen.getByText("展开报文内容"));
  fireEvent.click(screen.getByRole("tab", { name: "响应内容" }));
  fireEvent.click(screen.getByText("展开报文内容"));
  fireEvent.click(screen.getByRole("button", { name: "原始内容" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Synthetic response");
  fireEvent.click(screen.getByText("查看原始 usage"));
  expect(screen.getByText("查看原始 usage").parentElement).toHaveTextContent('"prompt_tokens": 10');
});
it("copies the saved body even while search filters the display and reports failures", async () => {
  const write = vi.fn().mockRejectedValue(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText: write } });
  render(<RequestPayloadViewer payload={payload} />);
  fireEvent.click(screen.getByText("展开报文内容"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "model" } });
  fireEvent.click(screen.getByRole("button", { name: "复制内容" }));
  expect(await screen.findByRole("status")).toHaveTextContent("复制失败");
  expect(write).toHaveBeenCalledWith(payload.request_body);
});
it("labels historical uncaptured streams and malformed truncated text", () => {
  const view = render(<RequestPayloadViewer payload={{ ...payload, response_body: '{"stream":true,"captured":false}' }} />);
  fireEvent.click(screen.getByRole("tab", { name: "响应内容" }));
  fireEvent.click(screen.getByText("展开报文内容"));
  expect(screen.getByText("此历史流仅保存状态摘要，未采集响应正文。")).toBeInTheDocument();
  view.rerender(<RequestPayloadViewer payload={{ ...payload, response_body: '{"broken": ... truncated', response_truncated: true }} />);
  expect(screen.getByText("内容已截断，仅展示已保存的部分。")).toBeInTheDocument();
  expect(screen.getByRole("tabpanel")).toHaveTextContent("非完整 JSON");
});
it("keeps request and response content collapsed until explicitly opened", () => {
  const view = render(<RequestPayloadViewer payload={payload} />);
  expect(view.container.querySelector(".diagnostic-content-disclosure")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("展开报文内容"));
  expect(view.container.querySelector(".diagnostic-content-disclosure")).toHaveAttribute("open");
  fireEvent.click(screen.getByRole("tab", { name: "响应内容" }));
  expect(view.container.querySelector(".diagnostic-content-disclosure")).not.toHaveAttribute("open");
});

it("shows raw usage only in response content and removes it when returning to request parameters", () => {
  render(<RequestPayloadViewer payload={payload} />);
  fireEvent.click(screen.getByText("展开报文内容"));
  expect(screen.queryByText("查看原始 usage")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "响应内容" }));
  fireEvent.click(screen.getByText("展开报文内容"));
  const usage = screen.getByText("查看原始 usage");
  expect(usage.parentElement).not.toHaveAttribute("open");
  fireEvent.click(usage);
  expect(usage.parentElement).toHaveTextContent('"prompt_tokens": 10');
  fireEvent.click(screen.getByRole("tab", { name: "请求参数" }));
  expect(screen.queryByText("查看原始 usage")).not.toBeInTheDocument();
});

it("labels missing snapshots", () => {
  render(<RequestPayloadViewer payload={null} />);
  expect(screen.getByText("这条历史记录没有保存 request / response 快照")).toBeVisible();
});
