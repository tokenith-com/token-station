import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type AppData, type Model, type ModelRoute, type ResourceConfig } from "../core/types";
import { emptyData } from "../domain/catalog";
import { filterRouteModels, routeModelCategories } from "../domain/entities";
import { externalModels } from "../domain/model-directory";
import { resourceConfigFor } from "../resources/settings-config";
import { RouteStrategyView } from "./model-catalog";

function routeData(): AppData {
  const models: Model[] = [
    { id: "configured", name: "configured-model", category: "custom", family: "custom", modality: "chat", status: "active" },
    { id: "draft", name: "draft-model", category: "custom", family: "custom", modality: "chat", status: "active", metadata: { directory_role: "external" } },
    { id: "builtin", name: "builtin-model", category: "claude", family: "claude", modality: "chat", status: "active", metadata: { source: "tokenhub-standard-catalog" } },
    { id: "public", name: "public-model", category: "claude", family: "claude", modality: "chat", status: "disabled", metadata: { source: "public-provider-conf" } },
    { id: "disabled-route", name: "disabled-route-model", category: "custom", family: "custom", modality: "chat", status: "active" },
  ];
  const routes: ModelRoute[] = [
    { id: "route", model_name: "configured-model", provider_id: "provider", provider_model: "upstream", priority: 1, weight: 100, status: "active", strategy: "balanced" },
    { id: "disabled-route", model_name: "disabled-route-model", provider_id: "provider", provider_model: "disabled-upstream", priority: 1, weight: 100, status: "disabled", strategy: "balanced" },
  ];
  return {
    ...emptyData(), models, routes,
    providers: [{ id: "provider", name: "Searchable Provider", type: "openai_compatible", status: "active", healthy: true, priority: 100 }],
  };
}

describe("route model display scopes", () => {
  it("follows the model selected in the directory when the navigation query changes", () => {
    const props = {
      config: resourceConfigFor("routes") as ResourceConfig<ModelRoute>, data: routeData(), loading: false,
      onCreate: vi.fn(), onOpenModels: vi.fn(), onOpenProviders: vi.fn(), onEdit: vi.fn(),
      onDelete: vi.fn(), onReorder: vi.fn(), onSavePolicy: vi.fn(),
    };
    const { container, rerender } = render(<RouteStrategyView {...props} initialQuery="draft-model" />);
    expect(container.querySelectorAll(".route-summary-table tbody tr")).toHaveLength(1);
    expect(screen.getByRole("row", { name: /draft-model/ })).toBeInTheDocument();
    rerender(<RouteStrategyView {...props} initialQuery="configured-model" />);
    expect(screen.getByPlaceholderText("搜索模型或 Provider")).toHaveValue("configured-model");
    expect(container.querySelectorAll(".route-summary-table tbody tr")).toHaveLength(1);
    expect(screen.getByRole("row", { name: /configured-model/ })).toBeInTheDocument();
  });

  it("matches master by excluding candidate templates from both display scopes", () => {
    const data = routeData();
    expect(filterRouteModels(data, "all", "all", "").map(model => model.name)).toEqual(["configured-model", "disabled-route-model", "draft-model"]);
    expect(filterRouteModels(data, "all", "configured", "").map(model => model.name)).toEqual(["configured-model", "disabled-route-model"]);
    expect(externalModels(data).map(model => model.name)).not.toContain("builtin-model");
  });

  it("counts all directory models in the sidebar independently of the selected scope", () => {
    const data = routeData();
    expect(routeModelCategories(data).find(category => category.key === "all")?.count).toBe(3);
    expect(routeModelCategories(data).find(category => category.key === "custom")?.count).toBe(3);
    expect(routeModelCategories(data).some(category => category.key === "claude")).toBe(false);
    expect(filterRouteModels(data, "claude", "all", "")).toEqual([]);
    expect(filterRouteModels(data, "all", "all", " DRAFT ").map(model => model.name)).toEqual(["draft-model"]);
    expect(filterRouteModels(data, "all", "configured", "searchable provider")).toHaveLength(2);
  });

  it("switches summary scopes while preserving categories, counts and selection", () => {
    const create = vi.fn();
    const { container } = render(<RouteStrategyView config={resourceConfigFor("routes") as ResourceConfig<ModelRoute>} data={routeData()} loading={false} onCreate={create} onOpenModels={vi.fn()} onOpenProviders={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onReorder={vi.fn()} onSavePolicy={vi.fn()} />);
    const allTab = screen.getByRole("tab", { name: /全部模型/ });
    const configuredTab = screen.getByRole("tab", { name: /已配置/ });
    const category = screen.getByRole("combobox", { name: "模型分类" });
    const categories = category.innerHTML;
    const rows = () => container.querySelectorAll(".route-summary-table tbody tr");
    expect(configuredTab).toHaveAttribute("aria-selected", "true");
    expect(rows()).toHaveLength(2);
    expect(allTab).toHaveTextContent("3");

    fireEvent.click(allTab);
    expect(allTab).toHaveAttribute("aria-selected", "true");
    expect(rows()).toHaveLength(3);
    expect(container.querySelector(".model-catalog-summary strong")).toHaveTextContent("3");
    expect(category.innerHTML).toBe(categories);
    const draft = screen.getByRole("row", { name: /draft-model/ });
    fireEvent.click(within(draft).getByRole("button", { name: "配置路由：draft-model" }));
    const dialog = screen.getByRole("dialog", { name: "配置模型路由" });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加线路" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "draft-model" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    fireEvent.change(screen.getByPlaceholderText("搜索模型或 Provider"), { target: { value: "draft" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText("搜索模型或 Provider"), { target: { value: "" } });
    fireEvent.click(configuredTab);
    expect(rows()).toHaveLength(2);
    expect(category.innerHTML).toBe(categories);
    fireEvent.click(allTab);
    fireEvent.change(category, { target: { value: "custom" } });
    expect(rows()).toHaveLength(3);
    fireEvent.click(configuredTab);
    expect(category).toHaveValue("custom");
    expect(category.innerHTML).toBe(categories);
    expect(rows()).toHaveLength(2);
    expect(screen.queryByRole("row", { name: /builtin-model/ })).not.toBeInTheDocument();
  });
});
