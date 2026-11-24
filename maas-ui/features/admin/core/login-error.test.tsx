import { describe, expect, it } from "vitest";
import { readLoginError } from "./api-client";
import { setActiveLanguage } from "../i18n/runtime";

function response(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("login error messages", () => {
  it("reports wrong credentials as status plus a localized reason", async () => {
    setActiveLanguage("zh-CN");
    const message = await readLoginError(response(401, { error: { code: "invalid_credentials", message: "Invalid username or password" } }));
    expect(message).toBe("401 · 账号或密码不正确");
    expect(message).not.toContain("Invalid username or password");
  });

  it("distinguishes a disabled account", async () => {
    setActiveLanguage("zh-CN");
    expect(await readLoginError(response(403, { error: { code: "admin_user_disabled" } }))).toBe("403 · 账号已被禁用，请联系管理员");
  });

  it("reports missing input and server faults", async () => {
    setActiveLanguage("zh-CN");
    expect(await readLoginError(response(400, { error: { code: "invalid_request" } }))).toBe("400 · 请输入账号和密码");
    expect(await readLoginError(response(500, "Internal server error"))).toBe("500 · 服务器内部错误，请稍后再试");
  });

  it("translates the reason for other languages", async () => {
    setActiveLanguage("en");
    expect(await readLoginError(response(401, { error: { code: "invalid_credentials" } }))).toBe("401 · Incorrect account or password");
    setActiveLanguage("zh-CN");
  });
});
