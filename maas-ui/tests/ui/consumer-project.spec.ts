import { capture, expect, test } from "./harness";
import { model, shellResponses, user } from "./fixtures/shell";

test("consumer-project model scope saves without team membership", async ({ page, api }, info) => {
  let project = { id: "prj_consumer", name: "Consumer Fixture Project", status: "active", team_id: "", teams: [], model_access_mode: "inherit", allowed_models: [] as string[], excluded_models: [] };
  const initial = shellResponses().get("GET /api/admin/overview") as Record<string, unknown>;
  api.replaceResponse("GET", "/api/admin/overview", { ...initial, projects: [project] });
  for (const path of ["teams", "cost-centers", "quota-policies", "project-members"]) api.respond("GET", `/api/admin/resources/${path}`, { data: [] });
  api.respond("GET", "/api/admin/users", { data: [user] });
  api.respond("GET", "/api/admin/approvals", { data: [] });
  api.define("GET", "/api/admin/audit/requests", () => ({ json: { data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 }, summary: { all: 0, ok: 0, error: 0 } } }), query => { expect(query.get("status")).toBe("all"); });
  api.define("PATCH", "/api/admin/projects/prj_consumer", input => {
    const body = input.body as typeof project;
    expect(body).not.toHaveProperty("team_id");
    expect(body.model_access_mode).toBe("restricted");
    expect(body.allowed_models).toEqual([model.name]);
    project = { ...project, ...body };
    api.replaceResponse("GET", "/api/admin/overview", { ...initial, projects: [project] });
    return { json: project };
  });
  await page.goto("/projects/");
  await page.getByRole("button", { name: "查看与配置", exact: true }).click();
  await page.getByRole("button", { name: "编辑项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: project.name });
  await expect(dialog.getByText("主团队（必选）", { exact: true })).toHaveCount(0);
  await dialog.getByRole("combobox", { name: /^模型访问模式/ }).selectOption("restricted");
  await dialog.getByText(model.name, { exact: true }).click();
  await dialog.getByRole("button", { name: "保存更改", exact: true }).click();
  await expect(page.getByText("项目设置已保存", { exact: true })).toBeVisible();
  expect(api.calls.filter(call => call.method !== "GET")).toHaveLength(1);
  await capture(page, info, page.locator(".project-workspace"), "consumer-project-model-scope", "C 端项目：无需团队即可保存模型权限", "viewport");
});
