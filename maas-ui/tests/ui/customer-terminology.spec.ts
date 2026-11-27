import { capture, expect, test } from "./harness";
import { project, shellResponses, user } from "./fixtures/shell";

test("customer terminology preserves exact-key project and team names", async ({ page, api }, info) => {
  const namedProject = { ...project, name: "项目", team_id: "review-team" };
  const overview = shellResponses().get("GET /api/admin/overview") as Record<string, unknown>;
  api.replaceResponse("GET", "/api/admin/overview", { ...overview, projects: [namedProject] });
  api.replaceResponse("GET", "/api/admin/projects", { data: [namedProject] });
  api.respond("GET", "/api/admin/users", { data: [user] });
  api.respond("GET", "/api/admin/resources/teams", { data: [{ id: "review-team", name: "团队", status: "active", fields: {} }] });
  for (const kind of ["cost-centers", "quota-policies", "project-members"]) api.respond("GET", `/api/admin/resources/${kind}`, { data: [] });
  api.respond("GET", "/api/admin/approvals", { data: [] });
  api.define("GET", "/api/admin/audit/requests", () => ({ json: { data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 }, summary: { all: 0, ok: 0, error: 0 } } }), query => { expect(query.get("status")).toBe("all"); });
  await page.goto("/projects/");
  await expect(page.getByRole("columnheader", { name: "客户项目", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "项目", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看与配置", exact: true }).click();
  await page.getByRole("button", { name: "编辑客户项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "项目", exact: true });
  await expect(dialog.getByRole("textbox", { name: "客户项目名称", exact: true })).toHaveValue("项目");
  await expect(dialog.getByRole("option", { name: "团队", exact: true })).toBeAttached();
  await expect(dialog.getByRole("option", { name: "客户团队", exact: true })).toHaveCount(0);
  await capture(page, info, dialog, "customer-terminology-exact-names", "超管静态标签加客户，真实名称保持不变", "viewport");
});
