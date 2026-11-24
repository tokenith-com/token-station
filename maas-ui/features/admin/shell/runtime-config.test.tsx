import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  [undefined, "/"],
  ["", "/"],
  ["/", "/"],
  ["https://api.example.com/", "https://api.example.com"],
])("resolves the static API base %s", async (value, expected) => {
  vi.stubEnv("NEXT_PUBLIC_TOKENHUB_API_BASE_URL", value);
  const { readRuntimeConfig } = await import("@/lib/runtime-config");
  expect(readRuntimeConfig().apiBaseURL).toBe(expected);
});
