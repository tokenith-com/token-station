import { afterEach, describe, expect, it, vi } from "vitest";
import { completeActivation, consumeActivationTokenFromURL, requestActivation, verifyActivation } from "./registration-api";

afterEach(() => vi.unstubAllGlobals());

describe("email activation API", () => {
  it("posts the email as JSON and returns the resend window", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ email: "a@example.com", expires_at: "2026-11-14T00:00:00Z", resend_after_secs: 60 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestActivation("a@example.com", "cap_1", "ABCD")).resolves.toMatchObject({ resend_after_secs: 60 });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/admin\/auth\/register\/activation$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "a@example.com", captcha_id: "cap_1", captcha_answer: "ABCD" });
  });

  it("maps backend error codes to localized messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "email_already_registered", message: "exists" } }, { status: 409 })));
    await expect(requestActivation("a@example.com", "cap_1", "ABCD")).rejects.toThrow("该邮箱已注册，请直接登录");
  });

  it("verifies the token through the query string", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ email: "a@example.com", expires_at: "x" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(verifyActivation("t+/=")).resolves.toMatchObject({ email: "a@example.com" });
    expect(String(fetcher.mock.calls[0][0])).toMatch(/activation\/verify\?token=t%2B%2F%3D$/);
  });

  it("completes activation with the confirmed password", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ user: {} }));
    vi.stubGlobal("fetch", fetcher);
    await completeActivation("token", "password1", "password1");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ token: "token", password: "password1", confirm_password: "password1" });
  });

  it("removes the activation token from the URL fragment", () => {
    const replace = vi.fn();
    expect(consumeActivationTokenFromURL("https://hub.example.com/login?x=1#activation_token=abc", replace)).toBe("abc");
    expect(replace).toHaveBeenCalledWith("/login?x=1");
    expect(consumeActivationTokenFromURL("https://hub.example.com/#other=1", replace)).toBe("");
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
