import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { emptyData } from "../domain/catalog";
import { adminFetch } from "../resources/payloads";
import { AuditView } from "./audit";

vi.mock("../resources/payloads", async (importOriginal) => ({
  ...await importOriginal<typeof import("../resources/payloads")>(),
  adminFetch: vi.fn(),
}));

it("loads server pages and resets the page when changing filters while retaining member layout", async () => {
  const requests: string[] = [];
  vi.mocked(adminFetch).mockImplementation(async (_api, path) => {
    requests.push(path);
    if (path.includes("/requests/")) return new Response(JSON.stringify({ log: { request_id: "page-1" }, usage: [], attempts: [] }));
    const params = new URL(path, "http://localhost").searchParams;
    const page = Number(params.get("page"));
    return new Response(JSON.stringify({
      data: [{ id: `log-${page}`, request_id: `page-${page}`, model: "server-only-model", status_code: 200, latency_ms: 10, created_at: "2026-10-16T00:00:00Z" }],
      pagination: { page, page_size: 20, total: 41, total_pages: 3 },
      summary: { all: 41, ok: 40, error: 1, average_latency_ms: 77 },
    }));
  });
  const data = emptyData();
  data.models = [{ id: "catalog", name: "catalog-only-model", family: "custom", modality: "chat", status: "active" }];
  const { container } = render(<AuditView api={{ baseURL: "", adminToken: "test" }} data={data}
    user={{ id: "member", username: "member", name: "Member", email: "member@test.invalid", role: "user", status: "active" }} />);
  await screen.findByText("page-1");
  expect(container.querySelector(".member-audit-view")).toBeInTheDocument();
  expect(container.querySelector(".request-list-head")).toHaveTextContent("41");
  expect(screen.getByText("77ms")).toBeInTheDocument();
  fireEvent.click(screen.getByTitle("下一页"));
  await screen.findByText("page-2");
  fireEvent.click(screen.getByRole("button", { name: "失败 1" }));
  await waitFor(() => expect(requests.some(path => path.includes("page=1") && path.includes("status=error"))).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "最近 1 小时" }));
  await waitFor(() => expect(requests.some(path => path.includes("since=") && path.includes("until="))).toBe(true));
  fireEvent.change(screen.getByRole("combobox", { name: "模型筛选" }), { target: { value: "catalog-only-model" } });
  await waitFor(() => expect(requests.some(path => path.includes("model=catalog-only-model"))).toBe(true));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "api-key-name" } });
  await waitFor(() => expect(requests.some(path => path.includes("q=api-key-name"))).toBe(true));
  expect(screen.queryByText("渠道真实成本")).not.toBeInTheDocument();
});

it("renders the server-resolved account name for a member without the user directory", async () => {
  vi.mocked(adminFetch).mockImplementation(async (_api, path) => {
    if (path.includes("/requests/")) {
      return new Response(JSON.stringify({
        log: { request_id: "req-account", project_id: "prj_taihu", api_key_id: "key_1", model: "m", status_code: 200, latency_ms: 5, created_at: "2026-10-16T00:00:00Z" },
        usage: [], attempts: [], payload: null,
        account: "太湖员工A / pt@locol.com",
      }));
    }
    return new Response(JSON.stringify({
      data: [{ id: "log-1", request_id: "req-account", model: "m", status_code: 200, latency_ms: 5, created_at: "2026-10-16T00:00:00Z" }],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      summary: { all: 1, ok: 1, error: 0, average_latency_ms: 5 },
    }));
  });
  // A member's data carries no users, so only the server-provided name can show.
  render(<AuditView api={{ baseURL: "", adminToken: "test" }} data={emptyData()}
    user={{ id: "member", username: "member", name: "Member", email: "member@test.invalid", role: "user", status: "active" }} />);
  await screen.findByText("req-account");
  fireEvent.click(screen.getByText("req-account"));
  expect(await screen.findByText("太湖员工A / pt@locol.com")).toBeInTheDocument();
  expect(screen.queryByText("usr_z2NA16gRki-BcS70")).not.toBeInTheDocument();
});
