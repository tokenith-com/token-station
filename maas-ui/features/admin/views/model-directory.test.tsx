import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type Model } from "../core/types";
import { emptyData } from "../domain/catalog";
import { ModelDirectoryView } from "./model-directory";

function directoryProps() {
  const data = emptyData();
  data.models = [
    { id: "published", name: "published-model", family: "custom", modality: "chat", status: "active" },
    { id: "draft", name: "draft-model", family: "custom", modality: "chat", status: "active", metadata: { directory_role: "external" } },
    { id: "disabled", name: "disabled-model", family: "custom", modality: "chat", status: "disabled", metadata: { directory_role: "external" } },
    { id: "template", name: "candidate-template", family: "claude", modality: "chat", status: "active", metadata: { source: "tokenhub-standard-catalog" } },
  ];
  data.providers = [{ id: "provider", name: "Real Provider", type: "openai_compatible", status: "active", healthy: true, priority: 100 }];
  data.routes = [{ id: "route", model_name: "published-model", provider_id: "provider", provider_model: "real-upstream", priority: 1, weight: 100, status: "active", strategy: "balanced" }];
  return {
    api: { baseURL: "", adminToken: "" },
    config: { view: "models" as const, title: "Models", eyebrow: "Models", description: "", fields: [], columns: [], list: () => data.models },
    data, loading: false, role: "admin" as const,
    onReload: vi.fn(), onCreateModel: vi.fn(), onOpenProviders: vi.fn(),
    onOpenRoutes: vi.fn<(model?: Model) => void>(), onEditModel: vi.fn(), onDeleteModel: vi.fn(),
  };
}

describe("native model directory", () => {
  it.each(["team_leader", "user", "consumer"] as const)("shows authorized external models and unified prices for %s without admin controls", (role) => {
    const props = directoryProps();
    props.data.models = [{ id: "authorized", name: "authorized-model", family: "custom", modality: "chat", status: "active", input_price_usd_per_1m: 2, output_price_usd_per_1m: 6 }];
    props.data.providers = [];
    props.data.routes = [];
    render(<ModelDirectoryView {...props} role={role} />);
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual([
      "对外模型", "类型与能力", "可用状态", "对外统一价",
    ]);
    const row = screen.getByRole("row", { name: /authorized-model/ });
    expect(row).toHaveTextContent("当前账号可用");
    expect(row).toHaveTextContent("$2.00/Mt");
    expect(row).toHaveTextContent("$6.00/Mt");
    expect(screen.queryByText("官方价")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建对外模型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "发布状态" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "筛选 Provider" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("搜索对外模型、Provider 或上游模型"), { target: { value: "not-authorized" } });
    expect(screen.queryByRole("row", { name: /authorized-model/ })).not.toBeInTheDocument();
    expect(screen.getByText("当前没有可见模型")).toBeInTheDocument();
  });

  it("uses master's columns, publication filters and model-specific route navigation", () => {
    const props = directoryProps();
    render(<ModelDirectoryView {...props} />);
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual([
      "对外模型", "类型与能力", "真实上游映射", "状态", "对外统一价", "操作",
    ]);
    expect(screen.getByRole("row", { name: /published-model/ })).toHaveTextContent("real-upstream");
    expect(screen.queryByRole("row", { name: /draft-model/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "路由策略：published-model" }));
    expect(props.onOpenRoutes).toHaveBeenCalledWith(props.data.models[0]);
    fireEvent.click(screen.getByRole("button", { name: "新建对外模型" }));
    expect(props.onCreateModel).toHaveBeenCalledOnce();
    const filters = screen.getByRole("group", { name: "发布状态" });
    fireEvent.click(within(filters).getByRole("button", { name: "草稿/待映射" }));
    expect(screen.getByRole("row", { name: /draft-model/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /published-model/ })).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole("button", { name: "全部" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByText("candidate-template")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "筛选 Provider" }), { target: { value: "provider" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("guides an empty directory to Providers instead of showing candidate templates", () => {
    const props = directoryProps();
    props.data.models = [props.data.models[3]];
    props.data.routes = [];
    render(<ModelDirectoryView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "前往供应商" }));
    expect(props.onOpenProviders).toHaveBeenCalledOnce();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
