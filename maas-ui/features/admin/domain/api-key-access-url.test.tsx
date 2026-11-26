import { expect, it } from "vitest";
import { apiKeyAccessConfig } from "./api-key-access";
import { apiKeyAccessConfig as legacyConfig } from "../legacy-source/domain/api-key-access";

it.each([apiKeyAccessConfig, legacyConfig])("resolves root and versioned paths consistently across entrypoints", resolve => {
  for (const base of ["/", "/v1", "/v1beta/"]) {
    expect(resolve(base, "chat", "synthetic", "model").base).toBe(`${window.location.origin}/v1`);
  }
  expect(resolve("https://gateway.example.test/prefix/v1beta/", "gemini", "synthetic", "model").endpoint).toBe("https://gateway.example.test/prefix/v1beta/models/model:generateContent");
});
