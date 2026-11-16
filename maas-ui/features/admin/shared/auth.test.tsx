import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyIdentityProviderTemplate, identityProviderEndpointDefaults, identityProviderTemplateOptionsFromData, identityProviderTemplatesFromData, LoginView } from "./auth";
import { PortalHome } from "./portal-home";

const baseProps = {
  loading: false,
  error: "",
  baseURL: "http://localhost:8080",
  identityProviders: [],
  oauthReturnURL: "http://localhost:3000/overview",
  language: "zh-CN" as const,
  theme: "light" as const,
  onLanguageChange: vi.fn(),
  onThemeToggle: vi.fn(),
};

describe("LoginView", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("shows the new homepage and login form by default without preview controls", () => {
    const { container } = render(<PortalHome {...baseProps}><LoginView {...baseProps} embedded onLogin={vi.fn()} /></PortalHome>);
    expect(container.querySelector(".tc-login-preview")).toBeInTheDocument();
    expect(container.querySelector(".tc-home-drawer")).not.toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.queryByText("设计预览")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "切回原版" })).not.toBeInTheDocument();
    expect(screen.getByText("示例数据 · 非真实业务用量")).toBeInTheDocument();
  });

  it("keeps the new homepage and login submission with legacy query parameters", async () => {
    window.history.replaceState(null, "", "/?loginDesign=preview&keep=value");
    const user = userEvent.setup();
    const onLogin = vi.fn();
    const { container } = render(<PortalHome {...baseProps}><LoginView {...baseProps} embedded onLogin={onLogin} /></PortalHome>);
    expect(container.querySelector(".tc-login-preview")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "切回原版" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?loginDesign=preview&keep=value");
    await user.clear(screen.getByLabelText("账号"));
    await user.type(screen.getByLabelText("账号"), "preview@example.test");
    await user.type(screen.getByLabelText("密码"), "fixture-password");
    await user.click(screen.getByRole("button", { name: /^登录$/ }));
    expect(onLogin).toHaveBeenCalledWith("preview@example.test", "fixture-password");
  });

  it("only shows OTP when supplied and delegates verification and return", async () => {
    window.history.replaceState(null, "", "/?keep=value#section");
    const user = userEvent.setup();
    const onLogin = vi.fn();
    const otpLogin = { identity: "admin@example.com", onVerify: vi.fn(), onBack: vi.fn() };
    const { rerender } = render(<LoginView {...baseProps} onLogin={onLogin} />);
    await user.type(screen.getByLabelText("密码"), "password");
    rerender(<LoginView {...baseProps} onLogin={onLogin} otpLogin={otpLogin} />);

    expect(screen.getByRole("form", { name: "手机号验证码认证" })).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toHaveValue(otpLogin.identity);
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "验证" }));
    expect(otpLogin.onVerify).toHaveBeenCalledWith("123456");
    expect(onLogin).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "返回账号密码登录" }));
    expect(otpLogin.onBack).toHaveBeenCalledOnce();
    rerender(<LoginView {...baseProps} onLogin={onLogin} />);

    expect(screen.getByLabelText("密码")).toHaveValue("");
    expect(window.location.search).toBe("?keep=value");
    expect(window.location.hash).toBe("#section");
  });

  it.each(["development", "production", "test"])("ignores the removed OTP preview parameter in %s", environment => {
    vi.stubEnv("NODE_ENV", environment);
    window.history.replaceState(null, "", "/?preview=otp");
    render(<LoginView {...baseProps} onLogin={vi.fn()} />);

    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "手机号验证码认证" })).not.toBeInTheDocument();
  });

  it("uses the shared branded card instead of the old consumer illustration", () => {
    const { container } = render(<LoginView {...baseProps} onLogin={vi.fn()} />);

    expect(screen.getByRole("main")).toHaveClass("tc-login");
    expect(screen.getByRole("heading", { name: "TokenStation" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("src", "/brand/tokencube-logo.svg");
    expect(container.querySelector(".login-account-visual")).not.toBeInTheDocument();
  });

  it("restores and immediately clears the remembered consumer account on opt out", async () => {
    window.localStorage.setItem("tokenstation.remembered-account", "consumer@example.test");
    const user = userEvent.setup();
    render(<LoginView {...baseProps} onLogin={vi.fn()} />);
    expect(screen.getByLabelText("账号")).toHaveValue("consumer@example.test");
    expect(screen.getByLabelText("密码")).toHaveValue("");
    await user.click(screen.getByRole("checkbox", { name: "记住账号" }));
    expect(window.localStorage.getItem("tokenstation.remembered-account")).toBeNull();
    await user.type(screen.getByLabelText("密码"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(window.localStorage.getItem("tokenstation.remembered-account")).toBeNull();
  });

  it("remembers only the trimmed consumer account on submit", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(<LoginView {...baseProps} onLogin={onLogin} />);
    await user.click(screen.getByRole("checkbox", { name: "记住账号" }));
    await user.type(screen.getByLabelText("账号"), " consumer@example.test ");
    await user.type(screen.getByLabelText("密码"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(window.localStorage.getItem("tokenstation.remembered-account")).toBe("consumer@example.test");
    expect(onLogin).toHaveBeenCalledWith(" consumer@example.test ", "fixture-password");
  });

  it("opens the embedded login without persisting an account by default", async () => {
    const user = userEvent.setup();
    render(<LoginView {...baseProps} embedded onLogin={vi.fn()} />);
    expect(screen.getByRole("main")).toHaveClass("tc-login", "embedded");
    expect(screen.getByRole("checkbox", { name: "记住账号" })).not.toBeChecked();
    await user.type(screen.getByLabelText("账号"), "tester@example.test");
    await user.type(screen.getByLabelText("密码"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(window.localStorage.getItem("tokenstation.remembered-account")).toBeNull();
  });

  it("allows consumer login when persistent storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    const user = userEvent.setup();
    const onLogin = vi.fn();
    const { rerender } = render(<LoginView {...baseProps} error="login 401" loading onLogin={onLogin} />);
    expect(screen.getByRole("alert")).toHaveTextContent("login 401");
    expect(screen.getByRole("button", { name: "登录中..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "邮箱注册" })).toBeDisabled();
    rerender(<LoginView {...baseProps} onLogin={onLogin} />);
    await user.type(screen.getByLabelText("账号"), "consumer@example.test");
    await user.type(screen.getByLabelText("密码"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(onLogin).toHaveBeenCalledWith("consumer@example.test", "fixture-password");
  });

  it("renders the centered card login layout with TokenStation branding", () => {
    const { container } = render(<LoginView {...baseProps} onLogin={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "欢迎回来" })).toBeInTheDocument();
    expect(screen.getByText("登录您的账户以继续")).toBeInTheDocument();
    expect(container.querySelector(".tc-login-title")).toHaveTextContent("TokenStation");
    expect(container.querySelector(".login-utility-controls")).not.toBeInTheDocument();
  });

  it("links to the company website", () => {
    render(<LoginView {...baseProps} onLogin={vi.fn()} />);

    const website = screen.getByRole("link", { name: "世纪利通官网" });
    expect(website).toHaveAttribute("href", "https://www.century-lt.com/cn/");
    expect(website).toHaveAttribute("target", "_blank");
    expect(website).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the updated footer copy", () => {
    render(<LoginView {...baseProps} onLogin={vi.fn()} />);

    expect(screen.getByText("世纪利通 版权所有 2024–2026")).toBeInTheDocument();
    expect(screen.getByText("沪ICP备2023030709号")).toBeInTheDocument();
    expect(screen.queryByText("申请试用")).not.toBeInTheDocument();
    expect(screen.queryByText("Copyright Century-Lt Tech Inc. All Rights Reserved.")).not.toBeInTheDocument();
    expect(screen.queryByText("沪ICP备15028292-1号")).not.toBeInTheDocument();
  });

  it("exposes email registration", async () => {
    const user = userEvent.setup();
    render(<LoginView {...baseProps} onLogin={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "邮箱注册" }));
    expect(screen.getByRole("heading", { name: "注册账号" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "已有账号？返回登录" }));
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
  });

  it("submits the entered identity and password", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(<LoginView {...baseProps} onLogin={onLogin} />);

    await user.type(screen.getByLabelText("账号"), "admin@example.com");
    await user.type(screen.getByLabelText("密码"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(onLogin).toHaveBeenCalledWith("admin@example.com", "correct-horse");
    expect(screen.queryByText("保持登录状态")).not.toBeInTheDocument();
  });

  it("hides SSO actions when no identity providers are configured", () => {
    render(<LoginView {...baseProps} onLogin={vi.fn()} />);

    expect(screen.queryByText("或")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SSO 企业单点登录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /登录/ })).not.toBeInTheDocument();
  });

  it("shows server errors and configured SSO entry points", () => {
    render(
      <LoginView
        {...baseProps}
        error="login 401"
        identityProviders={[{
          id: "idp_google",
          name: "company-google",
          display_name: "Company Google",
          provider_type: "oidc",
          icon_key: "google",
        }]}
        onLogin={vi.fn()}
      />,
    );

    expect(screen.getByText("login 401")).toHaveAttribute("class", "login-error");
    const sso = screen.getByRole("link", { name: "使用 Company Google 登录" });
    expect(sso).toHaveTextContent("Company Google");
    expect(sso).toHaveAttribute("href", expect.stringContaining("/api/admin/auth/oauth/start"));
    expect(sso).toHaveAttribute("href", expect.stringContaining("id=idp_google"));
  });
});

describe("identity provider template plugins", () => {
  it("adds identity provider templates from plugin capability metadata", () => {
    const data = {
      plugins: [{
        id: "tokenhub.identity.acme",
        name: "Acme Identity",
        version: "1.0.0",
        source: "marketplace",
        kinds: ["admin_ui"],
        placements: ["presentation"],
        capabilities: [{
          kind: "identity_provider_template",
          name: "entry",
          subject: "acme_sso",
          value: JSON.stringify({
            label: "Acme SSO",
            provider_type: "oidc",
            icon_key: "sso",
            login_label: "Acme",
            issuer_placeholder: "https://id.acme.example",
            scopes: "openid profile email",
            username_claim: "preferred_username",
            endpoints: {
              authorize_url: "{issuer}/authorize",
              token_url: "{issuer}/token",
              userinfo_url: "{issuer}/userinfo",
            },
          }),
        }],
      }],
    };

    const templates = identityProviderTemplatesFromData(data);
    const acme = templates.find((template) => template.key === "acme_sso");

    expect(identityProviderTemplateOptionsFromData(data)).toContainEqual({ value: "acme_sso", label: "Acme SSO" });
    expect(acme?.loginLabel).toBe("Acme");
    expect(identityProviderEndpointDefaults(acme!, "https://id.acme.example/tenant/")).toEqual({
      authorize_url: "https://id.acme.example/tenant/authorize",
      token_url: "https://id.acme.example/tenant/token",
      userinfo_url: "https://id.acme.example/tenant/userinfo",
    });
    expect(applyIdentityProviderTemplate({}, "acme_sso", true, templates)).toEqual(expect.objectContaining({
      provider_template: "acme_sso",
      provider_type: "oidc",
      login_label: "Acme",
      scopes: "openid profile email",
    }));
  });
});
