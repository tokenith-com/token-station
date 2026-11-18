import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { Model, Project } from "../core/types";
import { emptyData } from "../domain/catalog";
import { keyWizardModelOptions } from "../domain/formatting";
import { setActiveLanguage } from "../i18n/runtime";
import { ModelAccessList, apiKeyConfig } from "../resources/project-key-config";
import { projectModelAccessPayload } from "../resources/payloads";
import {
  ProjectWorkspace,
  projectWorkspaceDraft,
  saveProjectWorkspaceDraft,
} from "./project-workspace";

beforeEach(() => setActiveLanguage("zh-CN"));

it("preserves hidden selections during search and bulk selection, then clears all", async () => {
  function Editor() {
    const [selected, setSelected] = useState(["retired-model"]);
    return (
      <ModelAccessList
        label="项目模型禁用列表"
        models={["alpha", "beta"]}
        selected={selected}
        onChange={setSelected}
      />
    );
  }
  render(<Editor />);
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox");
  await user.type(search, "ALPHA");
  await user.click(screen.getByRole("button", { name: "全选当前搜索结果" }));
  expect(screen.getByRole("status")).toHaveTextContent("已选 2 个模型");
  await user.clear(search);
  expect(screen.getByRole("checkbox", { name: "retired-model" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "alpha" })).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "alpha" }));
  expect(screen.getByRole("status")).toHaveTextContent("已选 1 个模型");
  await user.type(search, "missing");
  expect(screen.getByText("没有匹配的模型")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "全选当前搜索结果" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "清空" }));
  expect(screen.getByRole("status")).toHaveTextContent("已选 0 个模型");
});

it("shows an empty model catalog", () => {
  render(
    <ModelAccessList
      label="项目模型允许列表"
      models={[]}
      selected={[]}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText("暂无可选模型")).toBeVisible();
});

it.each(["inherit", "restricted", "excluded"] as const)(
  "saves only the active %s model list",
  async (mode) => {
    const project: Project = {
      id: "project-test",
      name: "Test project",
      status: "active",
      model_access_mode: mode,
      allowed_models: ["alpha"],
      excluded_models: ["beta"],
    };
    const draft = projectWorkspaceDraft(project);
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, options) => {
        requests.push(JSON.parse(String(options?.body)));
        return new Response(JSON.stringify(project), { status: 200 });
      });
    try {
      await saveProjectWorkspaceDraft(
        { baseURL: "https://gateway.example.test", adminToken: "synthetic" },
        project,
        draft,
      );
      const expected = {
        model_access_mode: mode,
        allowed_models: mode === "restricted" ? ["alpha"] : [],
        excluded_models: mode === "excluded" ? ["beta"] : [],
      };
      expect(requests[0]).toMatchObject(expected);
      expect(
        projectModelAccessPayload({
          model_access_mode: mode,
          allowed_models: "alpha",
          excluded_models: "beta",
        }),
      ).toMatchObject(expected);
    } finally {
      fetchMock.mockRestore();
    }
  },
);

it("filters key candidates by project exclusion without adding a key exclusion mode", () => {
  const data = emptyData();
  data.models = ["alpha", "beta"].map(
    (name) => ({ name, status: "active", modality: "chat" }) as Model,
  );
  expect(
    keyWizardModelOptions(data, {
      model_access_mode: "excluded",
      excluded_models: ["beta"],
    }).map((model) => model.name),
  ).toEqual(["alpha"]);
  expect(
    keyWizardModelOptions(data, {
      model_access_mode: "restricted",
      allowed_models: [],
    }),
  ).toEqual([]);
  expect(
    apiKeyConfig().fields.find((field) => field.key === "model_access_mode")
      ?.options,
  ).toEqual(["inherit", "restricted"]);
});

it("offers three exclusive project modes and displays the exclusion list in view mode", async () => {
  const data = emptyData();
  const project: Project = {
    id: "project-test",
    name: "Test project",
    status: "active",
    model_access_mode: "excluded",
    excluded_models: ["beta"],
  };
  const props = {
    data,
    project,
    loading: false,
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onSave: vi.fn(),
    onIssueKey: vi.fn(),
    onAction: vi.fn(),
    onCreateMember: vi.fn(),
    onEditMember: vi.fn(),
    onDeleteMember: vi.fn(),
  };
  const view = render(<ProjectWorkspace {...props} mode="edit" />);
  const mode = screen.getByRole("combobox", { name: /^模型访问模式/ });
  expect(mode).toHaveValue("excluded");
  expect(screen.getByRole("checkbox", { name: "beta" })).toBeChecked();
  await userEvent.setup().selectOptions(mode, "inherit");
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  view.rerender(<ProjectWorkspace {...props} mode="view" />);
  expect(screen.getByText("指定模型禁用列表")).toBeVisible();
  expect(screen.getByText("beta")).toBeVisible();
});
