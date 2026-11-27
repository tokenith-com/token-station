import { expect, it } from "vitest";
import { responseUsage } from "./response-usage";

it("does not mistake tool output usage for provider billing usage", () => {
  expect(responseUsage(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: { usage: { disk_bytes: 99 } } } }] } }], usage: { total_tokens: 7 } })).records).toEqual([{ path: "$.usage", value: { total_tokens: 7 } }]);
});
it("retains native message and Responses streaming usage", () => {
  expect(responseUsage(JSON.stringify({ events: [{ data: { message: { usage: { input_tokens: 3 } } } }, { data: { response: { usage: { output_tokens: 2 } } } }] })).records).toHaveLength(2);
});
