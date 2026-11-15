import { expect, it } from "vitest";
import { parseWalletCharge } from "./wallet-action-dialog";

it("converts decimal currency to exact micros without rounding financial input", () => {
  expect(parseWalletCharge("0.0003")).toBe(300);
  expect(parseWalletCharge("12.345678")).toBe(12345678);
  expect(parseWalletCharge("0")).toBe(0);
  for (const value of ["", "-1", "1e3", "0.0000001", "1.1234567", "99999999999999999"]) expect(parseWalletCharge(value)).toBeNull();
});
