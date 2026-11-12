import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsumerRegistration } from "./consumer-registration";
import { verifyRegistrationCaptcha } from "./registration-captcha";

vi.mock("./registration-captcha", () => ({ verifyRegistrationCaptcha: vi.fn() }));
const proof = { lot_number: "lot", captcha_output: "output", pass_token: "token", gen_time: "time" };

beforeEach(() => { vi.mocked(verifyRegistrationCaptcha).mockReset().mockResolvedValue(proof); });

describe("consumer registration", () => {
  it("registers with the SMS session and returns to account login", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 200, session_id: "bound-session" }))
      .mockResolvedValueOnce(Response.json({ code: 200, message: "success" }));
    vi.stubGlobal("fetch", fetcher);
    const onRegistered = vi.fn();
    render(<ConsumerRegistration captchaID="app-id" onBack={vi.fn()} onRegistered={onRegistered} />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("设置密码"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000000" } });
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    expect(await screen.findByRole("button", { name: /秒后重发/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("短信验证码"), { target: { value: "123456" } });
    await user.click(screen.getByRole("button", { name: "注册" }));
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith("new@example.com"));
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe("/api/backend/api/admin/auth/register");
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ email: "new@example.com", name: "", password: "password123", mobile: "13800000000", code: "123456", session_id: "bound-session" });
  });

  it("invalidates the SMS session when the phone number changes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 200, session_id: "old-phone" })));
    render(<ConsumerRegistration captchaID="app-id" onBack={vi.fn()} onRegistered={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000000" } });
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    await screen.findByText("验证码已发送，请查看手机短信");
    expect(screen.getByRole("button", { name: "注册" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13900000000" } });
    expect(screen.getByRole("button", { name: "注册" })).toBeDisabled();
  });

  it("allows retry after captcha or SMS errors without starting a cooldown", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 401, message: "InvalidCode" })));
    render(<ConsumerRegistration captchaID="app-id" onBack={vi.fn()} onRegistered={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000000" } });
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("验证码错误");
    expect(screen.getByRole("button", { name: "获取验证码" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "注册" })).toBeDisabled();
  });
});
