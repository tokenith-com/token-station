import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError, backendRequest, backendURL, configureBackendBaseURL } from "./api-client";

afterEach(() => {
  configureBackendBaseURL("");
  vi.unstubAllGlobals();
});

describe("backend request target", () => {
  it("falls back to a relative path before the backend address is configured", () => {
    expect(backendURL("/api/admin/users")).toBe("/api/backend/api/admin/users");
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