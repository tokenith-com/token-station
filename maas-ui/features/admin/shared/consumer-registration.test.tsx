import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsumerActivation } from "./consumer-activation";
import { ConsumerRegistration } from "./consumer-registration";

afterEach(() => vi.unstubAllGlobals());

describe("consumer email registration", () => {
  it("requires agreement consent before sending the activation email", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ captcha_id: "cap_1", image: "data:image/png;base64,AAA", expires_in_secs: 300 }))
      .mockResolvedValueOnce(Response.json({ email: "a@example.com", expires_at: "x", resend_after_secs: 60 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsumerRegistration onBack={vi.fn()} />);

    await user.type(screen.getByLabelText("邮箱"), "a@example.com");
    await user.click(screen.getByRole("button", { name: "发送激活邮件" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请先阅读并同意");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toMatch(/register\/captcha$/);

    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByLabelText("验证码"), "ABCD");
    await user.click(screen.getByRole("button", { name: "发送激活邮件" }));
    expect(await screen.findByRole("heading", { name: "查收激活邮件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "60 秒后可重新发送" })).toBeDisabled();
  });

  it("opens the Chinese agreement documents", async () => {
    const user = userEvent.setup();
    render(<ConsumerRegistration onBack={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "《支付协议》" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("第五条（退款）");
    await user.click(screen.getByRole("button", { name: "我已阅读" }));
    await user.click(screen.getByRole("button", { name: "《用户服务协议》" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("第八条（禁止行为）");
  });

  it("verifies the activation link and sets the password", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ email: "a@example.com", expires_at: "x" }))
      .mockResolvedValueOnce(Response.json({ user: {} }));
    vi.stubGlobal("fetch", fetcher);
    const onDone = vi.fn();
    render(<ConsumerActivation token="token" onDone={onDone} />);

    expect(await screen.findByDisplayValue("a@example.com")).toBeInTheDocument();
    await user.type(screen.getByLabelText("设置密码"), "password1");
    await user.type(screen.getByLabelText("确认密码"), "password2");
    await user.click(screen.getByRole("button", { name: "激活账号" }));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");

    await user.clear(screen.getByLabelText("确认密码"));
    await user.type(screen.getByLabelText("确认密码"), "password1");
    await user.click(screen.getByRole("button", { name: "激活账号" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("a@example.com", true));
  });

  it("reports an expired activation link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "invalid_activation_token" } }, { status: 400 })));
    render(<ConsumerActivation token="bad" onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("激活链接无效或已过期");
  });
});
