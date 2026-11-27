import { expect, it } from "vitest";
import { formatSuccessRate } from "./success-rate";

it.each([
  [1, 243, "0.41"],
  [1, 6, "16.67"],
  [0, 243, "0.00"],
  [243, 243, "100.0"],
])("formats %s / %s consistently", (success, total, expected) => {
  expect(formatSuccessRate(success / total * 100)).toBe(expected);
});
