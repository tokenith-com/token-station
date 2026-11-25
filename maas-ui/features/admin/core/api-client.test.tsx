import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError, backendRequest, backendURL, configureBackendBaseURL, loginWithPassword, resetLoginPassword } from "./api-client";

afterEach(() => {
  configureBackendBaseURL("");
  vi.unstubAllGlobals();
});

describe("backend request target", () => {
  it("falls back to a relative path before the backend address is configured", () => {
    expect(backendURL("/api/admin/users")).toBe("/api/backend/api/admin/users");
  });

  it.each(["/", " / "])("keeps an explicit same-origin root %s out of the legacy proxy", root => {
    configureBackendBaseURL(root);
    expect(backendURL("/api/admin/auth/login")).toBe("/api/admin/auth/login");
    expect(backendURL("api/admin/users")).toBe("/api/admin/users");
  });

  it("preserves a same-origin gateway prefix", () => {
    configureBackendBaseURL("/gateway/");
    expect(backendURL("/api/admin/auth/login")).toBe("/gateway/api/admin/auth/login");
  });

  it("sends password login, reset and ordinary requests to the same origin", async () => {
    configureBackendBaseURL("/");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({
      token: "synthetic-session", expires_at: "2099-01-01T00:00:00Z", user: { id: "fixture-user", role: "admin" },
    })).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    await loginWithPassword(" fixture@example.test ", "fixture-password");
    await resetLoginPassword("fixture-reset-token", "fixture-new-password");
    await backendRequest("/api/admin/users");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/auth/login", "/api/admin/auth/reset-password", "/api/admin/users",
    ]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ identity: "fixture@example.test", password: "fixture-password" });
    expect(fetcher.mock.calls[0][1].headers.accept).toBe("application/json");
  });

  it("targets the configured backend and trims trailing slashes", () => {
    configureBackendBaseURL("https://hub.centlt.com/");
    expect(backendURL("/api/admin/users")).toBe("https://hub.centlt.com/api/admin/users");
    expect(backendURL("api/admin/users")).toBe("https://hub.centlt.com/api/admin/users");
  });

  it("negotiates JSON without dropping caller headers", async () => {
    configureBackendBaseURL("https://hub.centlt.com");
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    await backendRequest("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://hub.centlt.com/api/admin/auth/login");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers.accept).toBe("application/json");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
  });

  it("keeps an explicit accept header", async () => {
    configureBackendBaseURL("https://hub.centlt.com");
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    await backendRequest("/api/admin/reports/export", { headers: { accept: "text/csv" } });
    expect(fetcher.mock.calls[0][1].headers.accept).toBe("text/csv");
  });

  it("turns browser network or CORS failures into a readable error", async () => {
    configureBackendBaseURL("https://hub.centlt.com");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(backendRequest("/api/admin/users")).rejects.toBeInstanceOf(APIError);
    await expect(backendRequest("/api/admin/users")).rejects.toThrow("CORS");
  });
});