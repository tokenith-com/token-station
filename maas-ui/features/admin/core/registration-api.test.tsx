import { describe, expect, it, vi } from "vitest";
import { registerConsumer, sendRegistrationSMS, type CaptchaProof } from "./registration-api";

const proof = { lot_number: "lot", captcha_output: "output+&", pass_token: "proof", gen_time: "123" };

describe("SMS registration API", () => {
  it("posts all captcha fields as form data and returns the SMS session", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 200, message: "sms_sent", session_id: "sms-session" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(sendRegistrationSMS("13800000000", proof)).resolves.toBe("sms-session");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/backend/api/admin/auth/sendsms");
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ ...proof, mobile: "13800000000" });
  });

  it("rejects incomplete captcha proofs without sending SMS", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(sendRegistrationSMS("13800000000", {} as CaptchaProof)).rejects.toThrow("图形验证");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["ExpiredCode", "InvalidCode", "EmailExists", "MobileExists"])("rejects HTTP 200 business failure %s", async message => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 401, message })));
    await expect(registerConsumer({ email: "a@example.com", name: "", password: "password1", mobile: "13800000000", code: "123456", session_id: "sms" })).rejects.toThrow();
  });

  it("does not accept a successful SMS response without a session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 200, message: "sms_sent" })));
    await expect(sendRegistrationSMS("13800000000", proof)).rejects.toThrow("会话信息");
  });
});
