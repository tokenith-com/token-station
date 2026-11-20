import { render } from "@testing-library/react";
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
