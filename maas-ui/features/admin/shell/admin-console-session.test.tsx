import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSavedSession, saveSession } from "../core/session";
import type { AdminUser } from "../core/types";
import { AdminConsole } from "./admin-console";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/users",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const baseURL = "https://backend.example";
const user: AdminUser = { id: "admin", username: "admin", name: "Session Admin", email: "admin@example.com", role: "admin", status: "active" };
const session = { baseURL, token: "backend-session-token", user, expiresAt: "2099-01-01T00:00:00Z" };

async function openLoginForm(browser: ReturnType<typeof userEvent.setup>) {
  const homeLogin = document.querySelector<HTMLButtonElement>(".tc-home-login-btn");
  if (homeLogin) await browser.click(homeLogin);
  const password = await screen.findByLabelText("密码");
  return within(password.closest("form") as HTMLElement);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

describe("console session restoration", () => {
  it("offers configured SSO and email registration on the same login page", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "enterprise", name: "Enterprise SSO", provider_type: "oidc", login_label: "Enterprise SSO" }] }));
    vi.stubGlobal("fetch", fetcher);
    render(<AdminConsole defaultBaseURL={baseURL} />);
    await openLoginForm(userEvent.setup());
    expect(await screen.findByRole("link", { name: /Enterprise SSO/ })).toHaveAttribute("href", expect.stringContaining("/api/admin/auth/oauth/start?id=enterprise&return_url="));
    expect(screen.getByRole("button", { name: "邮箱注册" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(`${baseURL}/api/admin/auth/identity-providers`, expect.objectContaining({ credentials: "omit", headers: { accept: "application/json" } }));
    expect(fetcher.mock.calls.every(([path]) => path === `${baseURL}/api/admin/auth/identity-providers`)).toBe(true);
  });

  it.each(["http", "network"])("keeps password login available when provider discovery fails with %s errors", async failure => {
    vi.stubGlobal("fetch", failure === "http" ? vi.fn().mockResolvedValue(new Response(null, { status: 503 })) : vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<AdminConsole defaultBaseURL={baseURL} />);
    await openLoginForm(userEvent.setup());
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.queryByText(/Enterprise SSO/)).not.toBeInTheDocument();
  });
  it("reports invalid credentials as the status plus a localized reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "invalid_credentials", message: "Invalid username or password" } }, { status: 401 })));
    render(<AdminConsole defaultBaseURL={baseURL} />);
    const browser = userEvent.setup();
    const form = await openLoginForm(browser);
    await browser.type(form.getByRole("textbox", { name: "账号" }), "account@example.com");
    await browser.type(form.getByLabelText("密码"), "wrong-password");
    await browser.click(form.getByRole("button", { name: "登录" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("401 · 账号或密码不正确");
    expect(alert).not.toHaveTextContent("Invalid username or password");
    expect(readSavedSession()).toBeNull();
  });

  it.each(["admin", "team_leader", "user", "consumer"])("signs in role %s through the shared form", async role => {
    const account = { ...user, role };
    const fetcher = vi.fn().mockImplementation(async (path: string) => Response.json(path.endsWith("/auth/login")
      ? { token: session.token, user: account, expires_at: session.expiresAt } : { data: [] }));
    vi.stubGlobal("fetch", fetcher);
    render(<AdminConsole defaultBaseURL={baseURL} />);
    const browser = userEvent.setup();
    const form = await openLoginForm(browser);
    await browser.type(form.getByRole("textbox", { name: "账号" }), account.email);
    await browser.type(form.getByLabelText("密码"), "fixture-password");
    await browser.click(form.getByRole("button", { name: "登录" }));
    expect(await screen.findByText(account.name)).toBeInTheDocument();
    expect(readSavedSession()?.user.role).toBe(role);
  });

  it("restores the session across page mounts without requiring auth/me", async () => {
    saveSession(session);
    const fetcher = vi.fn().mockImplementation(async (path: string) => path.endsWith("/auth/me")
      ? new Response("redirected", { status: 302 }) : Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const firstPage = render(<StrictMode><AdminConsole defaultBaseURL={baseURL} /></StrictMode>);
    expect(await screen.findByText(user.name)).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`${baseURL}/api/admin/users`, expect.anything()));
    firstPage.unmount();

    render(<StrictMode><AdminConsole defaultBaseURL={baseURL} /></StrictMode>);
    expect(await screen.findByText(user.name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
    expect(readSavedSession()?.token).toBe(session.token);
    expect(fetcher.mock.calls.some(([path]) => path.endsWith("/auth/me"))).toBe(false);
  });

  it("returns to login when a business API reports an expired session", async () => {
    saveSession(session);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (path: string) =>
      Response.json({ data: [] }, { status: path.endsWith("/users") ? 401 : 200 })));
    render(<AdminConsole defaultBaseURL={baseURL} />);
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(readSavedSession()).toBeNull();
  });

  it("requires a new login after changing backends and restores the new session on the next page", async () => {
    saveSession({ ...session, baseURL: "https://old-backend.example" });
    const fetcher = vi.fn().mockImplementation(async (path: string) => Response.json(path.endsWith("/auth/login")
      ? { token: session.token, user, expires_at: session.expiresAt } : { data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const firstPage = render(<AdminConsole defaultBaseURL={baseURL} />);
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(readSavedSession()).toBeNull();
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      `${baseURL}/api/admin/auth/identity-providers`,
    ]);

    const browserUser = userEvent.setup();
    const form = await openLoginForm(browserUser);
    await browserUser.type(form.getByRole("textbox", { name: "账号" }), user.username);
    await browserUser.type(form.getByLabelText("密码"), "password");
    await browserUser.click(form.getByRole("button", { name: "登录" }));
    expect(await screen.findByText(user.name)).toBeInTheDocument();
    expect(readSavedSession()?.baseURL).toBe(baseURL);
    firstPage.unmount();

    render(<AdminConsole defaultBaseURL={baseURL} />);
    expect(await screen.findByText(user.name)).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([path]) => path.endsWith("/auth/me"))).toBe(false);
  });
});
