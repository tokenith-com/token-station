import { afterEach, expect, it, vi } from "vitest";
import { adminFetch, createAdminSaveAttempt } from "./payloads";

afterEach(() => vi.unstubAllGlobals());

it("tracks only the current form's mutation, excluding background requests and reads", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("{}")));
  const api = { baseURL: "http://localhost:8080", adminToken: "real-token" };
  const attempt = createAdminSaveAttempt(api);
  await adminFetch(attempt.api, "/api/admin/provider-catalog/custom");
  await adminFetch(api, "/api/admin/providers/test-connection", { method: "POST" });
  expect(attempt.requested).toBe(false);
  await adminFetch(attempt.api, "/api/admin/providers", { method: "POST", body: "{}" });
  expect(attempt.requested).toBe(true);
});

it("identifies a network failure during the form's save", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
  const attempt = createAdminSaveAttempt({ baseURL: "http://localhost:8080", adminToken: "real-token" });
  await expect(adminFetch(attempt.api, "/api/admin/models/test", { method: "PATCH", body: "{}" })).rejects.toThrow("network unavailable");
  expect(attempt.requested).toBe(true);
});
