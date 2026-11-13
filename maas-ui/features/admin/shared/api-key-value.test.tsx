import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { APIKey } from "../core/types";
import { APIKeyValue, configureAPIKeySecretContext } from "./api-key-value";

const apiKey = { id: "key_1", key_prefix: "th-abc", key_suffix: "wxyz" } as APIKey;

afterEach(() => {
  vi.unstubAllGlobals();
});

it("fetches the full key from the secret endpoint before revealing it", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "key_1", api_key: "th-abc-full-secret-wxyz" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  configureAPIKeySecretContext({ baseURL: "", adminToken: "session-token" });
  render(<APIKeyValue apiKey={apiKey} />);

  fireEvent.click(screen.getByRole("button", { name: "显示 Key" }));

  await waitFor(() => expect(screen.getByText("th-abc-full-secret-wxyz")).toBeInTheDocument());
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/api/admin/api-keys/key_1/secret");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-token");
});

it("explains that legacy keys must be rotated when no secret is stored", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
  configureAPIKeySecretContext({ baseURL: "", adminToken: "session-token" });
  render(<APIKeyValue apiKey={apiKey} />);

  fireEvent.click(screen.getByRole("button", { name: "复制 Key" }));

  expect(await screen.findByRole("status")).toHaveTextContent("该 Key 创建于旧版本，未保存完整值，请轮换后复制");
});
