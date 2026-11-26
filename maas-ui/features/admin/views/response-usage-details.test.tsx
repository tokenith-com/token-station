import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { responseUsage } from "../domain/response-usage";
import { ResponseUsageDetails } from "./response-usage-details";

it.each([
  { usage: { prompt_tokens: 124414, prompt_tokens_details: { cached_tokens: 123712 }, vendor_extension: { custom_units: 3 }, completion_tokens: 0 } },
  { usage: { input_tokens: 702, cache_read_input_tokens: 123712, cache_creation: { ephemeral_5m_input_tokens: 0 }, output_tokens: 783 } },
  { usageMetadata: { promptTokenCount: 124414, cachedContentTokenCount: 123712, candidatesTokenCount: 783 } },
])("renders all supplied provider fields without inventing fixed classifications", body => {
  const payload = { id: "p", request_id: "r", created_at: "2026-11-26T00:00:00Z", request_truncated: false, response_truncated: false, response_body: JSON.stringify(body) };
  render(<ResponseUsageDetails payload={payload} />);
  expect(screen.queryByText("input_audio_tokens")).not.toBeInTheDocument();
  const data = body.usage ?? body.usageMetadata;
  for (const key of Object.keys(data!)) expect(screen.getByText(key)).toBeInTheDocument();
});
it("keeps separate stream usage snapshots and paths rather than summing", () => {
  const body = JSON.stringify({ events: [{ data: { usage: { completion_tokens: 10 } } }, { data: { message: { usage: { completion_tokens: 20 } } } }] });
  expect(responseUsage(body).records).toEqual([
    { path: "$.events.0.data.usage", value: { completion_tokens: 10 } },
    { path: "$.events.1.data.message.usage", value: { completion_tokens: 20 } },
  ]);
});
it("does not infer usage from prompt strings or malformed historical bodies", () => {
  expect(responseUsage('{"content":"{\\"usage\\":{}}"}').records).toEqual([]);
  expect(responseUsage('{"usage": ... truncated').records).toEqual([]);
  render(<ResponseUsageDetails payload={null} />);
  expect(screen.getByText(/未采集原始用量/)).toBeInTheDocument();
});

it("groups aliases and nested reasoning fields without merging their values", () => {
  render(<ResponseUsageDetails payload={{ id: "p", request_id: "r", created_at: "", request_truncated: false, response_truncated: false, response_body: JSON.stringify({ usage: {
    input_tokens: 1284, prompt_tokens: 1284, output_tokens: 241, completion_tokens: 241,
    output_tokens_details: { reasoning_tokens: 134 }, reasoning_output_tokens: 134,
    total_tokens: 1525, vendor_extension: { custom_units: 2 },
  } }) }} />);
  const input = within(screen.getByRole("region", { name: "输入用量" }));
  expect(input.getByText("input_tokens")).toBeInTheDocument();
  expect(input.getByText("prompt_tokens")).toBeInTheDocument();
  const output = within(screen.getByRole("region", { name: "输出用量" }));
  expect(output.getByText("reasoning_tokens")).toBeInTheDocument();
  expect(output.getByText("reasoning_output_tokens")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "总量字段" })).getByText("1,525")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "其他用量字段" })).getByText("custom_units")).toBeInTheDocument();
});
