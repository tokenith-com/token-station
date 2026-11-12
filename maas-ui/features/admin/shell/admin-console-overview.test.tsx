import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { saveSession } from "../core/session";
import type { AdminUser, RequestLog } from "../core/types";
import { emptySummary } from "../domain/catalog";
import { AdminConsole } from "./admin-console";

const navigation = vi.hoisted(() => ({ pathname: "/overview", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => navigation,
}));

const baseURL = "https://backend.example";
const summary = { ...emptySummary(), request_count: 134, input_tokens: 1000, output_tokens: 200, total_tokens: 1200 };
const logs: RequestLog[] = Array.from({ length: 20 }, (_, index) => ({
  id: `request-${index}`,
  request_id: `request-${index}`,
  project_id: "project",
  api_key_id: "key",
  model: "test-model",
  status_code: 200,
  latency_ms: 100,
  created_at: "2026-10-28T00:00:00Z",
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  navigation.pathname = "/overview";
  navigation.push.mockImplementation((path: string) => { navigation.pathname = path; });
  navigation.replace.mockImplementation((path: string) => { navigation.pathname = path; });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

function requestMetric(role: string) {
  if (role === "admin") {
    // 超管总览已改用源码前端的 overview 实现（.metric-label / .metric-value）。
    const label = screen.getByText("总请求", { selector: ".metric-label" });
    return label.closest("article")!.querySelector(".metric-value");
  }
  const label = screen.getByText("请求量", { selector: ".dashboard-kpi-label" });
  return label.closest("article")!.querySelector(".dashboard-kpi-value");
}

it.each(["admin", "team_leader", "user"])("loads %s overview on first mount and refresh without visiting request logs", async role => {
  const user: AdminUser = { id: role, username: role, name: "Overview User", email: "overview@example.com", role, status: "active" };
  saveSession({ baseURL, token: "overview-token", user, expiresAt: "2099-01-01T00:00:00Z" });
  const fetcher = vi.fn().mockImplementation(async (path: string) => {
    const pathname = new URL(path).pathname;
    if (pathname === "/api/admin/overview") return Response.json({ summary, projects: [], providers: [], models: [] });
    if (pathname === "/api/admin/usage/breakdown") return Response.json({ models: [], members: [], provider_resources: [] });
    if (pathname === "/api/admin/usage/report") return Response.json({ range: "all", summary, breakdown: { members: [] }, timeseries: [] });
    if (pathname === "/api/admin/audit/requests") return Response.json({
      data: logs,
      pagination: { page: 1, page_size: 20, total: 134, total_pages: 7 },
      summary: { all: 134, ok: 134, error: 0, average_latency_ms: 100 },
    });
    if (pathname.startsWith("/api/admin/plugin")) {
      // 超管总览走源码前端实现，会拉取插件清单。
      return role === "admin" ? Response.json({ data: [] }) : Response.json({ error: { code: "admin_forbidden" } }, { status: 403 });
    }
    if (pathname.startsWith("/api/admin/resources/")) {
      return Response.json({ error: { code: "admin_forbidden" } }, { status: 403 });
    }
    return Response.json({ data: [] });
  });
  vi.stubGlobal("fetch", fetcher);

  const mount = () => render(<StrictMode><AdminConsole defaultBaseURL={baseURL} /></StrictMode>);
  const firstPage = mount();
  await waitFor(() => expect(requestMetric(role)).toHaveTextContent("134"));
  expect(screen.queryByText("连接失败")).not.toBeInTheDocument();
  if (role !== "admin") expect(screen.getByText("100", { selector: ".dashboard-kpi-value" })).toHaveTextContent("100ms");
  firstPage.unmount();

  mount();
  await waitFor(() => expect(requestMetric(role)).toHaveTextContent("134"));
  expect(fetcher.mock.calls.filter(([path]) => new URL(path).pathname === "/api/admin/overview").length).toBeGreaterThanOrEqual(2);
  if (role !== "admin") {
    expect(fetcher.mock.calls.some(([path]) => new URL(path).pathname.startsWith("/api/admin/plugin"))).toBe(false);
  }

  if (role === "admin") {
    // 源码总览直接使用 /api/admin/overview 的 summary，不再单独拉 usage/report。
    expect(fetcher.mock.calls.some(([path]) => new URL(path).pathname === "/api/admin/overview")).toBe(true);
    return;
  }
  expect(fetcher.mock.calls.some(([path]) => new URL(path).pathname === "/api/admin/usage/report" && new URL(path).searchParams.get("range") === "all")).toBe(false);
  const browserUser = userEvent.setup();
  await browserUser.click(screen.getByRole("button", { name: "请求日志" }));
  await waitFor(() => expect(navigation.pathname).toBe("/audit"));
  await browserUser.click(screen.getByRole("button", { name: role === "team_leader" ? "团队总览" : "总览" }));
  await waitFor(() => expect(requestMetric(role)).toHaveTextContent("134"));
  expect(screen.getByText("100", { selector: ".dashboard-kpi-value" })).toHaveTextContent("100ms");
});
