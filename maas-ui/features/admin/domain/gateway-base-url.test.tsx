import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGatewayBaseURL, apiReferenceURL } from "./formatting";
import { apiGatewayBaseURL as legacyGatewayBaseURL } from "../legacy-source/domain/formatting";

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["main", apiGatewayBaseURL],
  ["legacy", legacyGatewayBaseURL],
] as const)("%s gateway documentation URLs", (_name, resolve) => {
  it.each([
    ["/", "http://localhost:3000/v1"],
    ["/v1", "http://localhost:3000/v1"],
    ["/gateway/", "http://localhost:3000/gateway/v1"],
    ["http://localhost:8080/", "http://localhost:8080/v1"],
    ["https://gateway.example.test/v1/", "https://gateway.example.test/v1"],
    [" https://gateway.example.test/ ", "https://gateway.example.test/v1"],
    ["", "http://localhost:8080/v1"],
  ])("resolves %s to an absolute SDK endpoint", (input, expected) => {
    expect(resolve(input)).toBe(expected);
  });

  it("resolves production HTTPS origins and preserves gateway prefixes", () => {
    vi.stubGlobal("window", { location: { origin: "https://gateway.example.test:8443" } });
    expect(resolve("/")).toBe("https://gateway.example.test:8443/v1");
    expect(resolve("/gateway/v1/")).toBe("https://gateway.example.test:8443/gateway/v1");
    expect(resolve(" https://api.example.test/gateway/ ")).toBe("https://api.example.test/gateway/v1");
  });

  it("does not require window for explicit backend URLs", () => {
    vi.stubGlobal("window", undefined);
    expect(resolve("https://gateway.example.test")).toBe("https://gateway.example.test/v1");
  });
});

it("resolves the API reference against the same origin", () => {
  expect(apiReferenceURL("/")).toBe("http://localhost:3000/docs");
});
