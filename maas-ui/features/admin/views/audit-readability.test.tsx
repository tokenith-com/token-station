import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyData } from "../domain/catalog";
import type { AppData, RequestDetail } from "../core/types";
import { RequestDetailPanel, requestAccountLabel } from "./audit";

const detail: RequestDetail = {
  log: { id: "log", request_id: "req-one", project_id: "p", api_key_id: "k", model: "rerank", status_code: 200, latency_ms: 12, created_at: "2026-09-22T00:00:00Z" },
  attempts: [], usage: [],
  error_detail: { message: "upstream failed" },
};

function dataWithAccount(): AppData {
  const data = emptyData();
  data.projects = [{ id: "p", name: "太湖", status: "active", model_access_mode: "inherit", allowed_models: [], excluded_models: [], owner_user_id: "usr_member", team_id: "team_taihu" }] as never;
  data.users = [{ id: "usr_member", username: "pt", name: "太湖员工A", email: "pt@locol.com", role: "user", status: "active", team_id: "team_taihu" }] as never;
  return data;
}

// Only platform administrators may inspect stored request/response snapshots.
describe("request detail privacy", () => {
  it("hides the request and response snapshot section", () => {
    render(<RequestDetailPanel data={emptyData()} requestID="req-one" detail={detail} loading={false} error="" />);
    expect(screen.queryByText("Paris is the capital")).not.toBeInTheDocument();
    expect(screen.queryByText("请求与响应")).not.toBeInTheDocument();
  });

  const withPayload: RequestDetail = { ...detail, payload: { id: "body", request_id: "req-one", request_body: "Synthetic request content", response_body: "Synthetic response content", request_truncated: false, response_truncated: false, created_at: detail.log.created_at } };

  it("shows both snapshots only to platform administrators", () => {
    render(<RequestDetailPanel data={emptyData()} requestID="req-one" detail={withPayload} loading={false} error="" role="admin" />);
    expect(screen.getByText("请求与响应")).toBeInTheDocument();
    const metadata = screen.getByText("详情", { selector: "summary" }).closest("details")!;
    const payloadSection = screen.getByRole("region", { name: "请求与响应" });
    expect(metadata.compareDocumentPosition(payloadSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByText("展开报文内容"));
    expect(screen.getByText("Synthetic request content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "响应内容" }));
    fireEvent.click(screen.getByText("展开报文内容"));
    expect(screen.getByText("Synthetic response content")).toBeInTheDocument();
  });

  it.each(["security", "team_leader", "user", "consumer"] as const)("hides snapshots for %s even if supplied", role => {
    render(<RequestDetailPanel data={emptyData()} requestID="req-one" detail={withPayload} loading={false} error="" role={role} />);
    expect(screen.queryByText("请求与响应")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic request content")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic response content")).not.toBeInTheDocument();
  });

  it("keeps the remaining detail fields selectable across requests", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const props = { data: emptyData(), requestID: "req-one", detail, loading: false, error: "", showProviderCost: false };
      const view = render(<RequestDetailPanel {...props} />);
      expect(screen.queryByText("估算成本")).not.toBeInTheDocument();
      view.rerender(<RequestDetailPanel {...props} requestID="req-two" detail={{ ...detail, log: { ...detail.log, request_id: "req-two" } }} />);
      expect(screen.getByText("req-two")).toBeInTheDocument();
      expect(errors).not.toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });
});

describe("request detail project field", () => {
  it("shows both the project and the account to platform administrators", () => {
    render(<RequestDetailPanel data={dataWithAccount()} requestID="req-one" detail={detail} loading={false} error="" role="admin" />);
    expect(screen.getByText("项目")).toBeInTheDocument();
    expect(screen.getByText("账户")).toBeInTheDocument();
    expect(screen.getByText("太湖员工A / pt@locol.com")).toBeInTheDocument();
  });

  it.each(["team_leader", "user", "consumer"] as const)("replaces the project with the account for %s", (role) => {
    render(<RequestDetailPanel data={dataWithAccount()} requestID="req-one" detail={detail} loading={false} error="" role={role} />);
    expect(screen.queryByText("项目")).not.toBeInTheDocument();
    expect(screen.getByText("账户")).toBeInTheDocument();
    expect(screen.getByText("太湖员工A / pt@locol.com")).toBeInTheDocument();
  });
});

describe("server-resolved account", () => {
  it("prefers the account the detail payload carries", () => {
    const data = emptyData(); // no users loaded, which is the member's case
    render(<RequestDetailPanel data={data} requestID="req-one" detail={{ ...detail, account: "太湖员工A / pt@locol.com" }} loading={false} error="" role="user" />);
    expect(screen.getByText("太湖员工A / pt@locol.com")).toBeInTheDocument();
    expect(screen.queryByText("项目")).not.toBeInTheDocument();
  });
});

describe("requestAccountLabel", () => {
  it("prefers the attributed user, then the key owner, then the project owner", () => {
    const data = dataWithAccount();
    data.users = [
      ...data.users,
      { id: "usr_key_owner", username: "ko", name: "Key Owner", email: "ko@locol.com", role: "user", status: "active", team_id: "team_taihu" },
    ] as never;
    data.keys = [{ id: "k", project_id: "p", owner_user_id: "usr_key_owner", name: "K" }] as never;
    const base = { ...detail.log };

    expect(requestAccountLabel(data, { ...base, attributed_user_id: "usr_member" } as never)).toBe("太湖员工A / pt@locol.com");
    expect(requestAccountLabel(data, base)).toBe("Key Owner / ko@locol.com");
    expect(requestAccountLabel(data, { ...base, api_key_id: "missing" })).toBe("太湖员工A / pt@locol.com");
  });
});
