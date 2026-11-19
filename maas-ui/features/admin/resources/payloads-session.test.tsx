import { afterEach, describe, expect, it, vi } from "vitest";
import { authExpiredEventName } from "../core/types";
import { adminFetch } from "./payloads";

afterEach(() => vi.unstubAllGlobals());

describe("Cloud session compatibility", () => {
  it.each([302, 403, 404, 500, 502])("does not expire a session for an ordinary HTTP %s response", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    const expired = vi.fn();
    window.addEventListener(authExpiredEventName, expired);
    try {
      const response = await adminFetch({ baseURL: "https://backend.example", adminToken: "real-token" }, "/api/admin/users");
      expect(response.status).toBe(status);
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(authExpiredEventName, expired);
    }
  });

  it("does not expire a session when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const expired = vi.fn();
    window.addEventListener(authExpiredEventName, expired);
    try {
      await expect(adminFetch({ baseURL: "https://backend.example", adminToken: "real-token" }, "/api/admin/users")).rejects.toThrow("Failed to fetch");
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(authExpiredEventName, expired);
    }
  });

  it("identifies the expired token so a stale response cannot log out a newer session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const expired = vi.fn();
    window.addEventListener(authExpiredEventName, expired);
    try {
      await expect(adminFetch({ baseURL: "http://localhost:8080", adminToken: "expired-token" }, "/api/admin/models")).rejects.toThrow();
      expect(expired).toHaveBeenCalledTimes(1);
      expect((expired.mock.calls[0][0] as CustomEvent).detail).toBe("expired-token");
    } finally {
      window.removeEventListener(authExpiredEventName, expired);
    }
  });

  it("rejects a demo token without sending it to the real backend", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(adminFetch({ baseURL: "http://localhost:8080", adminToken: "tokenhub-mock:admin" }, "/api/admin/models")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps multipart boundaries under browser control when uploading through the proxy", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const body = new FormData();
    body.append("file", new Blob(["test"]), "test.txt");
    await adminFetch({ baseURL: "http://localhost:8080", adminToken: "real-token" }, "/api/admin/plugins", { method: "POST", body });
    expect(fetch.mock.calls[0][0]).toBe("/api/backend/api/admin/plugins");
    expect((fetch.mock.calls[0][1].headers as Headers).has("content-type")).toBe(false);
  });
});
