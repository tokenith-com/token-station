import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { saveSession } from "../core/session";
import { authExpiredEventName, type AdminUser } from "../core/types";
import { permissionDeniedMessage } from "../resources/payloads";
import { AdminConsole } from "./admin-console";

const navigation = vi.hoisted(() => ({ pathname: "/api-keys", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => navigation,
}));

const baseURL = "https://backend.example";
const project = { id: "project", name: "Team project", owner_user_id: "owner", team_id: "team", status: "active" };
const key = { id: "key", name: "Application key", project_id: project.id, owner_user_id: "owner", key_prefix: "sk-test", key_suffix: "1234", status: "active" };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  navigation.pathname = "/api-keys";
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function mount(role = "team_leader") {
  const user: AdminUser = { id: "owner", username: "owner", name: "Team Owner", email: "owner@example.test", role, team_id: "team", status: "active" };
  saveSession({ baseURL, token: "test-token", user, expiresAt: "2099-01-01T00:00:00Z" });
  const fetcher = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") return Response.json({ error: { message: "Save rejected" } }, { status: 500 });
    const pathname = new URL(path).pathname;
    if (pathname === "/api/admin/overview") return Response.json({ projects: [project], models: [], providers: [] });
    const data = pathname === "/api/admin/projects" ? [project]
      : pathname === "/api/admin/api-keys" ? [key]
        : pathname === "/api/admin/users" ? [user]
          : pathname === "/api/admin/resources/teams" ? [{ id: "team", name: "Team", status: "active", fields: { owner_user_id: user.id } }]
            : [];
    return Response.json({ data });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<AdminConsole defaultBaseURL={baseURL} />);
  return fetcher;
}

it.each(["team_leader", "user"])("restores master key issuance for %s and closes only after a failed save request", async role => {
  const fetcher = mount(role);
  const browser = userEvent.setup();
  expect(await screen.findByText(key.name)).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "IP 白名单" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "归属项目" }) !== null).toBe(role === "team_leader");
  await browser.click(screen.getByRole("button", { name: role === "user" ? "创建 Key" : "发放 Key" }));
  await browser.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  await browser.type(screen.getByLabelText("Key 名称"), "New app key");
  for (let step = 0; step < 3; step++) await browser.click(screen.getByRole("button", { name: "下一步" }));
  await browser.click(screen.getByRole("button", { name: "生成 Key" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "生成 Key" })).not.toBeInTheDocument());
  expect(fetcher).toHaveBeenCalledWith(`${baseURL}/api/admin/projects/project/keys`, expect.objectContaining({
    method: "POST", body: expect.stringContaining('"owner_user_id":"owner"'),
  }));
  expect(await screen.findByText(/Save rejected/)).toBeInTheDocument();
});

it("opens key access instructions and requires confirmation before rotation", async () => {
  const fetcher = mount();
  const browser = userEvent.setup();
  await browser.click(await screen.findByRole("button", { name: "使用" }));
  const access = screen.getByRole("dialog", { name: "使用 API Key" });
  expect(within(access).getByLabelText("接入地址（Base URL）")).toHaveValue(`${baseURL}/v1`);
  await browser.click(within(access).getByRole("button", { name: "关闭" }));
  await browser.click(screen.getByRole("button", { name: "轮换" }));
  expect(fetcher.mock.calls.some(([path]) => path.endsWith("/rotate"))).toBe(false);
  await browser.click(screen.getByRole("button", { name: "确认轮换" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`${baseURL}/api/admin/api-keys/key/rotate`, expect.objectContaining({ method: "POST" })));
});

it("opens the project workspace and closes it when its save API fails", async () => {
  navigation.pathname = "/projects";
  const fetcher = mount();
  const browser = userEvent.setup();
  await browser.click(await screen.findByRole("button", { name: "查看与配置" }));
  const workspace = screen.getByRole("dialog", { name: project.name });
  await browser.click(within(workspace).getByRole("button", { name: "编辑项目" }));
  expect(within(workspace).getByLabelText("项目名称")).toHaveValue(project.name);
  await browser.click(within(workspace).getByRole("button", { name: "保存更改" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(fetcher).toHaveBeenCalledWith(`${baseURL}/api/admin/projects/project`, expect.objectContaining({ method: "PATCH" }));
  expect(await screen.findByText(/Save rejected/)).toBeInTheDocument();
});

it("keeps late business permission failures out of the login form after session expiry", async () => {
  navigation.pathname = "/projects";
  const fetcher = mount();
  const browser = userEvent.setup();
  await browser.click(await screen.findByRole("button", { name: "查看与配置" }));
  await browser.click(screen.getByRole("button", { name: "编辑项目" }));
  let rejectSave!: (reason: Error) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectSave = reject; }));
  await browser.click(screen.getByRole("button", { name: "保存更改" }));
  expect(rejectSave).toBeDefined();

  act(() => window.dispatchEvent(new CustomEvent(authExpiredEventName, { detail: "test-token" })));
  expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
  await act(async () => rejectSave(new Error(permissionDeniedMessage("plugins"))));

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/当前账号没有访问/)).not.toBeInTheDocument();
});
