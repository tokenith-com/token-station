import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyData } from "../domain/catalog";
import { ProjectWorkspace, projectWorkspaceDraft, saveProjectWorkspaceDraft } from "./project-workspace";
import type { Project } from "../core/types";

const project: Project = {
  id: "prj_taihu",
  name: "Taihu",
  status: "active",
  model_access_mode: "restricted",
  allowed_models: ["model-a", "model-b"],
  excluded_models: [],
} as Project;

function renderWorkspace(canEditModelScope: boolean) {
  const onCreateMember = vi.fn();
  render(
    <ProjectWorkspace
      mode="edit"
      data={emptyData()}
      project={project}
      loading={false}
      canEditModelScope={canEditModelScope}
      onClose={vi.fn()}
      onEdit={vi.fn()}
      onSave={vi.fn()}
      onIssueKey={vi.fn()}
      onAction={vi.fn()}
      onCreateMember={onCreateMember}
      onEditMember={vi.fn()}
      onDeleteMember={vi.fn()}
    />,
  );
}

describe("project workspace model scope", () => {
  it("offers the editable model list to platform administrators", () => {
    renderWorkspace(true);
    expect(document.querySelector(".project-model-access")).not.toBeNull();
    expect(document.querySelector(".project-model-access-notice")).toBeNull();
  });

  it("shows the platform-owned notice to team leaders", () => {
    renderWorkspace(false);
    expect(document.querySelector(".project-model-access")).toBeNull();
    expect(document.querySelector(".project-model-access-notice")).not.toBeNull();
  });

  it("omits the scope fields from a team leader save", async () => {
    const calls: Array<[string, string]> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), String(init?.body ?? "")]);
      return new Response(JSON.stringify({ ...project }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await saveProjectWorkspaceDraft({ baseURL: "http://gateway.local", adminToken: "token" }, project, projectWorkspaceDraft(project), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const body = JSON.parse(calls[0][1]) as Record<string, unknown>;
    expect(body).not.toHaveProperty("model_access_mode");
    expect(body).not.toHaveProperty("allowed_models");
    expect(body).not.toHaveProperty("excluded_models");
  });

  it("sends the scope fields for a platform administrator save", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ ...project }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await saveProjectWorkspaceDraft({ baseURL: "http://gateway.local", adminToken: "token" }, project, projectWorkspaceDraft(project), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const body = JSON.parse(calls[0]) as Record<string, unknown>;
    expect(body.model_access_mode).toBe("restricted");
    expect(body.allowed_models).toEqual(["model-a", "model-b"]);
  });
});


describe("consumer project workspace", () => {
  const consumer = { ...project, id: "prj_consumer", team_id: "", teams: [] };
  it("allows model scope submission without a primary team", () => {
    const onSave = vi.fn();
    render(<ProjectWorkspace mode="edit" data={emptyData()} project={consumer} loading={false} onClose={vi.fn()} onEdit={vi.fn()} onSave={onSave} onIssueKey={vi.fn()} onAction={vi.fn()} onCreateMember={vi.fn()} onEditMember={vi.fn()} onDeleteMember={vi.fn()} />);
    expect(screen.queryByText("主团队（必选）")).not.toBeInTheDocument();
    expect(document.querySelector("select[required]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ model_access_mode: "restricted", allowed_models: ["model-a", "model-b"] }));
  });
  it("saves model restrictions without team writes, even if the draft has stale team selections", async () => {
    const original = globalThis.fetch;
    const fetch = vi.fn().mockResolvedValue(Response.json(consumer));
    globalThis.fetch = fetch;
    try {
      const draft = { ...projectWorkspaceDraft(consumer), primary_team_id: "stale-team" };
      await saveProjectWorkspaceDraft({ baseURL: "http://gateway.local", adminToken: "fixture" }, consumer, draft);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [path, init] = fetch.mock.calls[0];
      expect(String(path)).toContain("/api/admin/projects/prj_consumer");
      expect(init.method).toBe("PATCH");
      const body = JSON.parse(init.body);
      expect(body).not.toHaveProperty("team_id");
      expect(body).toMatchObject({ model_access_mode: "restricted", allowed_models: ["model-a", "model-b"] });
    } finally { globalThis.fetch = original; }
  });
  it("retains required primary team selection for enterprise projects", () => {
    renderWorkspace(true);
    expect(screen.getByText("主团队（必选）")).toBeInTheDocument();
    expect(document.querySelector("select[required]")).not.toBeNull();
  });
});
