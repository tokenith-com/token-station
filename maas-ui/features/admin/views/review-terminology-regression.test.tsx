import { afterEach, beforeEach, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CustomerCopyProvider } from "../i18n/customer-copy";
import { emptyData } from "../domain/catalog";
import { FieldInput } from "../legacy-source/shared/ui";
import { EntityTable } from "../legacy-source/views/settings-table";
import { resourceConfigFor } from "../legacy-source/resources/settings-config";
import { setActiveLanguage as setSourceLanguage } from "../legacy-source/i18n/runtime";
import { setActiveLanguage, tx } from "../i18n/runtime";
import { routeProjectScopeSummary } from "../domain/entities";
import { customerCopyKey } from "../i18n/customer-copy";
import { ModelDirectoryDetail } from "../legacy-source/views/model-directory-detail";

beforeEach(() => { setActiveLanguage("zh-CN"); setSourceLanguage("zh-CN"); });
afterEach(() => { setActiveLanguage("zh-CN"); setSourceLanguage("zh-CN"); });

it("preserves project names that exactly match an interface key", () => {
 const data = emptyData();
 data.projects = [{ id: "review-project", name: "项目", status: "active" }];
 const key = { id: "review-key", name: "Synthetic key", project_id: "review-project", status: "active", key_prefix: "sk-review", key_suffix: "1234" };
 render(<CustomerCopyProvider administrator><EntityTable config={resourceConfigFor("api-keys")!} data={data as never} items={[key]} onEdit={() => {}} onDelete={() => {}} onAction={() => {}} /></CustomerCopyProvider>);
 expect(screen.getByRole("cell", { name: "项目" })).toBeInTheDocument();
});

it("preserves team option names that exactly match an interface key", () => {
 render(<CustomerCopyProvider administrator><FieldInput field={{ key: "team_id", label: "主团队", type: "select", optionsFromData: () => [{ value: "review-team", label: "团队" }] }} data={emptyData() as never} value="review-team" editing onChange={() => {}} /></CustomerCopyProvider>);
 expect(screen.getByRole("option", { name: "团队" })).toBeInTheDocument();
});

it("prefixes the static part of a restricted project scope without modifying the project name", () => {
 const data = emptyData();
 const model = { id: "review-model", name: "review-model", status: "active", modality: "chat", family: "test" };
 data.models = [model];
 data.projects = [{ id: "review-project", name: "Synthetic Project", status: "active" }];
 data.routes = [{ id: "review-route", model_name: model.name, provider_id: "review-provider", provider_model: "upstream", status: "active", priority: 1, weight: 100, project_scope: "include", project_ids: ["review-project"] }];
 render(<CustomerCopyProvider administrator><ModelDirectoryDetail model={model as never} data={data as never} readOnly={false} onClose={() => {}} /></CustomerCopyProvider>);
 expect(screen.getByText(/仅指定客户项目: Synthetic Project/)).toBeInTheDocument();
});

it.each(["select", "multi-select", "tag-select"] as const)("preserves exact-key names in %s selectors", type => {
 render(<CustomerCopyProvider administrator><FieldInput field={{ key: "review", label: "主团队", type, multiSelectOnEdit: true, optionsFromData: () => [{ value: "review-team", label: "团队" }] }} data={emptyData() as never} value="review-team" editing onChange={() => {}} /></CustomerCopyProvider>);
 expect(screen.getByText("团队", { exact: true })).toBeInTheDocument();
 expect(screen.queryByText("客户团队", { exact: true })).not.toBeInTheDocument();
});

it.each(["all", "include", "exclude"] as const)("localizes only the static %s scope prefix", scope => {
 const data = emptyData();
 data.projects = [{ id: "p", name: "项目", status: "active" }];
 const route = { project_scope: scope, project_ids: ["p"] };
 const localize = (value: string) => customerCopyKey(value);
 const result = routeProjectScopeSummary(route as never, data, localize);
 expect(result).toBe(scope === "all" ? "所有客户项目" : `${scope === "include" ? "仅指定客户项目" : "排除指定客户项目"}: 项目`);
 const ordinary = routeProjectScopeSummary(route as never, data);
 expect(ordinary).not.toContain("客户");
});

it.each(["en", "ja", "ru"] as const)("translates scope prefixes in %s without translating project names", language => {
 setActiveLanguage(language);
 const data = emptyData();
 data.projects = [{ id: "p", name: "项目", status: "active" }];
 const route = { project_scope: "include", project_ids: ["p"] };
 const result = routeProjectScopeSummary(route as never, data, value => tx(customerCopyKey(value)));
 expect(result).toBe(`${tx("仅指定客户项目")}: 项目`);
 expect(result).not.toContain("仅指定客户项目");
});
