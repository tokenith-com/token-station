import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminResource, AdminUser } from "../core/types";
import { emptyData } from "../domain/catalog";
import { createTeamMember, teamMemberCreatePayload, userPayload } from "../resources/payloads";
import { adminUserConfig } from "../resources/governance-config";
import { PlatformAccountsView } from "./platform-accounts";

const leader: AdminUser = { id: "leader", username: "manager", name: "管理者", email: "manager@example.test", role: "team_leader", team_id: "team-a", status: "active" };
const member: AdminUser = { id: "member", username: "member01", name: "测试成员", email: "member@example.test", role: "user", team_id: "team-a", status: "active" };
const platformTeam: AdminResource = { id: "team_platform", kind: "teams", name: "Platform Engineering Team", status: "active" };

function renderAccounts(variant: "team" | "platform" = "team", currentUser = leader, users = [member], teams = [variant === "platform" ? platformTeam : { ...platformTeam, id: "team-a" }], roleConfigs: AdminResource[] = []) {
  const data = emptyData();
  data.users = users;
  data.resources.teams = teams;
  data.resources["role-configs"] = roleConfigs;
  const onCreate = vi.fn().mockResolvedValue(true);
  const onEdit = vi.fn().mockResolvedValue(true);
  const onResetPassword = vi.fn().mockResolvedValue(true);
  const rendered = render(<PlatformAccountsView variant={variant} data={data} currentUser={currentUser} loading={false} onCreate={onCreate} onEdit={onEdit} onResetPassword={onResetPassword} onToggleStatus={vi.fn()} onDelete={vi.fn()} />);
  return { onCreate, onEdit, onResetPassword, data, ...rendered };
}

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillNewMember() {
  fill(/姓名/, "新成员");
  fill(/邮箱/, "new-member@example.test");
  fill(/用户名/, "new-member");
  fill(/^\*密码$/, "new-test-password");
  fill(/确认密码/, "new-test-password");
}

describe("team member account forms", () => {
  it("shows the designed columns and supports email search without group controls", () => {
    renderAccounts();
    expect(screen.getAllByRole("columnheader").map(item => item.textContent)).toEqual(["姓名", "备注", "用户名", "邮箱", "角色", "团队", "状态", "创建时间", "操作"]);
    expect(screen.getByRole("cell", { name: member.email })).toBeInTheDocument();
    expect(screen.queryByLabelText("分组筛选")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重置密码" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: member.email } });
    expect(screen.getByRole("cell", { name: member.username })).toBeInTheDocument();
  });

  it("requires email and creates members through the team-members API", async () => {
    const { onCreate } = renderAccounts();
    fireEvent.click(screen.getByRole("button", { name: "新增团队成员" }));
    fill(/姓名/, "新成员");
    fill(/用户名/, "new-member");
    fill(/^\*密码$/, "new-test-password");
    fill(/确认密码/, "new-test-password");
    fireEvent.submit(screen.getByRole("dialog"));
    expect(screen.getByRole("alert")).toHaveTextContent("请填写所有必填项");
    expect(onCreate).not.toHaveBeenCalled();
    fill(/邮箱/, "new-member@example.test");
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const payload = teamMemberCreatePayload(onCreate.mock.calls[0][0]);
    expect(payload).toMatchObject({
      name: "新成员",
      username: "new-member",
      email: "new-member@example.test",
      password: "new-test-password",
      status: "active",
      project_role: "developer",
    });
    expect(payload).not.toHaveProperty("team_id");
    expect(payload).not.toHaveProperty("role");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits email while leaving the saved password unchanged when both password fields are empty", async () => {
    const { onEdit } = renderAccounts();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText(/用户名/)).toBeDisabled();
    expect(screen.getByLabelText(/用户名/)).toHaveValue(member.username);
    expect(screen.getAllByPlaceholderText("编辑时留空则不修改")).toHaveLength(2);
    expect(within(screen.getByRole("dialog")).queryByText("团队分组")).not.toBeInTheDocument();
    fill(/邮箱/, "updated@example.test");
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    const payload = userPayload(onEdit.mock.calls[0][1], false);
    expect(payload).toMatchObject({ username: member.username, email: "updated@example.test", role: member.role, team_id: member.team_id });
    expect(payload).not.toHaveProperty("password");
  });

  it("blocks incomplete or mismatched password changes before saving", () => {
    const { onEdit } = renderAccounts();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fill(/^\*密码$/, "new-test-password");
    fireEvent.submit(screen.getByRole("dialog"));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    fill(/确认密码/, "different-password");
    fireEvent.submit(screen.getByRole("dialog"));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("includes a confirmed new password in the edit API payload", async () => {
    const { onEdit } = renderAccounts();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fill(/^\*密码$/, "new-test-password");
    fill(/确认密码/, "new-test-password");
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(userPayload(onEdit.mock.calls[0][1], false)).toHaveProperty("password", "new-test-password");
  });

  it("retains role and reset-password controls in the platform account view", () => {
    renderAccounts("platform");
    expect(screen.getByRole("columnheader", { name: "角色" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "邮箱" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置密码" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(within(screen.getByRole("dialog")).queryByLabelText(/密码/)).not.toBeInTheDocument();
  });

  it.each(["platform", "team"] as const)("shows role and named teams in the %s account list", (variant) => {
    const teams = [platformTeam, { ...platformTeam, id: "team-b", name: "第二团队" }];
    const roleConfigs: AdminResource[] = [{ id: "role-user", kind: "role-configs", name: "成员角色", status: "active", fields: { role_key: "user", display_name: "普通成员" } }];
    renderAccounts(variant, leader, [{ ...member, team_id: platformTeam.id, team_ids: [platformTeam.id, "team-b"] }], teams, roleConfigs);
    expect(screen.getAllByRole("columnheader").map(item => item.textContent)).toEqual([
      "姓名", "备注", "用户名", ...(variant === "team" ? ["邮箱"] : []), "角色", "团队", "状态", "创建时间", "操作",
    ]);
    expect(screen.getByRole("cell", { name: "普通成员" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Platform Engineering Team, 第二团队" })).toHaveAttribute("title", "Platform Engineering Team, 第二团队");
  });

  it.each(["platform", "team"] as const)("shows missing and unresolved team memberships in the %s account list", (variant) => {
    renderAccounts(variant, leader, [
      { ...member, team_id: undefined, team_ids: [] },
      { ...member, id: "unknown-team-member", username: "unknown-team", team_id: "team-unresolved" },
    ], []);
    const teamColumn = screen.getAllByRole("columnheader").findIndex(header => header.textContent === "团队");
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell")[teamColumn]).toHaveTextContent("-");
    expect(within(rows[2]).getAllByRole("cell")[teamColumn]).toHaveTextContent("team-unresolved");
  });

  it.each(["platform", "team"] as const)("spans every %s account column in the empty state", (variant) => {
    renderAccounts(variant, leader, []);
    expect(screen.getByRole("cell")).toHaveAttribute("colspan", variant === "team" ? "9" : "8");
  });

  it("shows API-authorized members whose primary team is different", () => {
    renderAccounts("team", leader, [{ ...member, team_id: "team-b", team_ids: ["team-b", "team-a"] }]);
    expect(screen.getByRole("cell", { name: member.username })).toBeInTheDocument();
  });

  it.each([
    leader,
    { ...leader, team_id: undefined, team_ids: ["team-a"] },
  ])("creates team members without any team resource (%j)", async (currentUser) => {
    const { onCreate } = renderAccounts("team", currentUser, [], []);
    fireEvent.click(screen.getByRole("button", { name: "新增团队成员" }));
    expect(within(screen.getByRole("dialog")).queryByLabelText(/团队|角色/)).not.toBeInTheDocument();
    fillNewMember();
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const payload = teamMemberCreatePayload(onCreate.mock.calls[0][0]);
    expect(payload).toMatchObject({ project_role: "developer" });
    expect(payload).not.toHaveProperty("team_id");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks platform account creation without a default team", () => {
    const currentUser = { ...leader, role: "admin", team_id: undefined, team_ids: [] };
    const { onCreate } = renderAccounts("platform", currentUser, [], []);
    fireEvent.click(screen.getByRole("button", { name: "新增用户" }));
    fill(/姓名/, "New account");
    fill(/用户名/, "new-account");
    fill(/^\*密码$/, "new-test-password");
    fill(/确认密码/, "new-test-password");
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "user" } });
    fireEvent.submit(screen.getByRole("dialog"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("暂无可用的主团队，请联系平台管理员配置团队后重试");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("resolves a team loaded after opening the create dialog", async () => {
    const currentUser = { ...leader, role: "admin", team_id: undefined };
    const { onCreate, data, rerender } = renderAccounts("platform", currentUser, [], []);
    fireEvent.click(screen.getByRole("button", { name: "新增用户" }));
    fill(/姓名/, "New account");
    fill(/用户名/, "new-account");
    fill(/^\*密码$/, "new-test-password");
    fill(/确认密码/, "new-test-password");
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "user" } });
    rerender(<PlatformAccountsView variant="platform" data={{ ...data, resources: { ...data.resources, teams: [platformTeam] } }} currentUser={currentUser} loading={false} onCreate={onCreate} onEdit={vi.fn()} onResetPassword={vi.fn()} onToggleStatus={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(userPayload(onCreate.mock.calls[0][0], true)).toMatchObject({ role: "user", team_id: platformTeam.id, team_ids: [platformTeam.id] });
  });

  it("sends the leader's create through the team-members API without a team or role field", async () => {
    const { onCreate } = renderAccounts("team", leader, []);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      project_id: "prj_new",
      project_member_id: "pm_new",
      user: { ...member, id: "new-member-id", username: "new-member", email: "new-member@example.test" },
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    onCreate.mockImplementation(async (values) => {
      await createTeamMember({ baseURL: "http://localhost:8080", adminToken: "leader-token" }, values);
      return true;
    });
    fireEvent.click(screen.getByRole("button", { name: "新增团队成员" }));
    expect(within(screen.getByRole("dialog")).queryByLabelText(/团队|角色/)).not.toBeInTheDocument();
    fillNewMember();
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [path, request] = fetch.mock.calls[0];
    expect(path).toBe("/api/backend/api/admin/team-members");
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer leader-token");
    const payload = JSON.parse(request.body);
    expect(payload).toMatchObject({
      username: "new-member",
      name: "新成员",
      email: "new-member@example.test",
      password: "new-test-password",
      project_role: "developer",
    });
    expect(payload).not.toHaveProperty("team_id");
    expect(payload).not.toHaveProperty("role");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("preserves additional memberships when editing a member", async () => {
    const { onEdit } = renderAccounts("team", leader, [{ ...member, team_ids: ["team-a", "team-b"] }]);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fill(/备注/, "Updated");
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(userPayload(onEdit.mock.calls[0][1], false)).toMatchObject({ team_id: "team-a", team_ids: ["team-a", "team-b"] });
  });

  it("preserves hidden team memberships when platform administrators edit an account", async () => {
    const { onEdit } = renderAccounts("platform", { ...leader, role: "admin" }, [{ ...leader, team_id: undefined, team_ids: ["team-b"] }]);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(within(screen.getByRole("dialog")).queryByLabelText(/团队/)).not.toBeInTheDocument();
    fill(/备注/, "Updated");
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(userPayload(onEdit.mock.calls[0][1], false)).toMatchObject({ role: "team_leader", team_id: "", team_ids: ["team-b"] });
  });

  it.each(["admin", "team_leader", "user"])("keeps the original platform form and creates %s through the shared API with the administrator's token", async (role) => {
    const actor = { ...leader, role: "admin" };
    const { onCreate, data } = renderAccounts("platform", actor, []);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...member, id: "new-account-id", username: "new-account", role, team_id: platformTeam.id }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    onCreate.mockImplementation(async (values) => {
      await adminUserConfig().create?.({ baseURL: "http://localhost:8080", adminToken: "admin-token" }, values, data);
      return true;
    });
    fireEvent.click(screen.getByRole("button", { name: "新增用户" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByLabelText(/团队|邮箱/)).not.toBeInTheDocument();
    expect(dialog.getAllByRole("combobox")).toHaveLength(1);
    expect(dialog.getByLabelText(/备注/)).toBeInTheDocument();
    fill(/姓名/, "New account");
    fill(/用户名/, "new-account");
    fill(/^\*密码$/, "new-test-password");
    fill(/确认密码/, "new-test-password");
    fireEvent.change(dialog.getByRole("combobox", { name: "角色" }), { target: { value: role } });
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, request] = fetch.mock.calls[0];
    expect(path).toBe("/api/backend/api/admin/users");
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer admin-token");
    expect(JSON.parse(request.body)).toMatchObject({ role, username: "new-account", team_id: platformTeam.id, team_ids: [platformTeam.id] });
  });

  it.each(["team", "platform"] as const)("closes the %s form when the create API fails", async (variant) => {
    const { onCreate } = renderAccounts(variant, variant === "platform" ? { ...leader, role: "admin" } : leader);
    onCreate.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: variant === "team" ? "新增团队成员" : "新增用户" }));
    if (variant === "team") fillNewMember();
    else {
      fill(/姓名/, "新账号");
      fill(/用户名/, "new-account");
      fill(/^\*密码$/, "new-test-password");
      fill(/确认密码/, "new-test-password");
      fireEvent.change(screen.getByRole("combobox", { name: "角色" }), { target: { value: "user" } });
    }
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each(["team", "platform"] as const)("closes the %s form when the edit API fails", async (variant) => {
    const { onEdit } = renderAccounts(variant, variant === "platform" ? { ...leader, role: "admin" } : leader);
    onEdit.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fill(/备注/, "Updated");
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the password form when the reset API fails", async () => {
    const { onResetPassword } = renderAccounts("platform", { ...leader, role: "admin" });
    onResetPassword.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    fill(/^\*新密码$/, "new-test-password");
    fill(/确认新密码/, "new-test-password");
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onResetPassword).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
