import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerCopyProvider, customerCopyKey, customerResourceConfig } from "../i18n/customer-copy";
import { setActiveLanguage } from "../i18n/runtime";
import { customerCopyKeys } from "../i18n/customer-copy-keys";
import { customerTerminologyTranslations } from "../i18n/customer-terminology";
import { resourceConfigFor } from "../resources/settings-config";
import { roleViewAccess } from "../core/navigation";
import { FieldInput, SimpleTable } from "../shared/ui";
import { emptyData } from "../domain/catalog";

afterEach(() => setActiveLanguage("zh-CN"));
it("prefixes each static occurrence exactly once", () => {
  const result = customerCopyKey("主团队与协作团队管理项目；客户项目和客户团队保持不变");
  expect(result).toBe("主客户团队与协作客户团队管理客户项目；客户项目和客户团队保持不变");
  expect(customerCopyKey(result)).toBe(result);
});
it("never double-prefixes copy that already says 客户", () => {
  for (const original of ["客户团队", "客户项目", "客户团队与客户项目", "团队", "项目", "团队分组", "项目空间"]) {
    const once = customerCopyKey(original);
    expect(customerCopyKey(once), original).toBe(once);
  }
  expect(customerCopyKey("团队")).toBe("客户团队");
  expect(customerCopyKey("项目")).toBe("客户项目");
  expect(customerCopyKey("客户团队")).toBe("客户团队");
});
it("clones display metadata without mutating cached config or callbacks", () => {
  const config = resourceConfigFor("projects")!;
  const before = JSON.stringify(config);
  const cloned = customerResourceConfig(config, true)!;
  expect(cloned.title).toBe("客户项目空间");
  expect(cloned.fields.find(field => field.key === "team_id")!.label).toBe("默认客户团队");
  expect(cloned.toForm).toBe(config.toForm);
  expect(cloned.update).toBe(config.update);
  expect(cloned.fields.find(field => field.key === "team_id")!.optionsFromData).toBe(config.fields.find(field => field.key === "team_id")!.optionsFromData);
  expect(JSON.stringify(config)).toBe(before);
  expect(customerResourceConfig(config, false)).toBe(config);
});
it("updates only headings and static field labels across role changes, not row data or option names", () => {
  const onChange = vi.fn();
  const name = "研发团队的项目";
  function Contents({ admin }: { admin: boolean }) {
    return <CustomerCopyProvider administrator={admin}><SimpleTable columns={["团队", "项目"]} rows={[[name, "客户项目真实名称"]]} /><FieldInput field={{ key: "team_id", label: "主团队", type: "select", optionsFromData: () => [{ value: "team-id", label: name }] }} data={emptyData()} value="team-id" editing onChange={onChange} /></CustomerCopyProvider>;
  }
  const view = render(<Contents admin />);
  expect(screen.getByRole("columnheader", { name: "客户团队" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "客户项目" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "team-id" } });
  expect(onChange).toHaveBeenCalledWith("team-id");
  view.rerender(<Contents admin={false} />);
  expect(screen.getByRole("columnheader", { name: "团队" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "主团队" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "客户团队" })).not.toBeInTheDocument();
});
it("provides English and Japanese translations for every inventoried static key", () => {
  for (const original of customerCopyKeys) {
    const key = customerCopyKey(original);
    if (key === original) continue;
    expect(customerTerminologyTranslations.en, original).toHaveProperty(key);
    expect(customerTerminologyTranslations.ja, original).toHaveProperty(key);
  }
});
it("keeps the three terminology catalogs keyed identically", () => {
  const { en, ja, ru } = customerTerminologyTranslations;
  expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
});
it("shows customer wording in administrator table headers but not for other roles", () => {
  function Header({ admin }: { admin: boolean }) {
    return (
      <CustomerCopyProvider administrator={admin}>
        <SimpleTable columns={["团队", "项目", "客户团队", "客户项目"]} rows={[["团队", "项目", "客户团队", "客户项目"]]} />
      </CustomerCopyProvider>
    );
  }
  const view = render(<Header admin />);
  for (const name of ["客户团队", "客户项目"]) {
    expect(screen.getAllByRole("columnheader", { name })).toHaveLength(2);
  }
  expect(screen.queryByRole("columnheader", { name: "客户客户团队" })).not.toBeInTheDocument();
  view.rerender(<Header admin={false} />);
  expect(screen.getAllByRole("columnheader", { name: "团队" })).toHaveLength(1);
  expect(screen.getAllByRole("columnheader", { name: "客户团队" })).toHaveLength(1);
  expect(screen.queryByRole("columnheader", { name: "客户客户团队" })).not.toBeInTheDocument();
});
it("covers every administrator-facing resource list, field, action and toolbar label", () => {
  const views = roleViewAccess.admin;
  expect(views.length).toBeGreaterThan(10);
  let checked = 0;
  for (const view of views) {
    const config = resourceConfigFor(view as Parameters<typeof resourceConfigFor>[0]);
    if (!config) continue;
    checked += 1;
    const admin = customerResourceConfig(config, true)!;
    const labels = [
      admin.title, admin.eyebrow, admin.createLabel ?? "",
      ...admin.columns.map(column => column.label),
      ...admin.fields.flatMap(field => [field.label, field.help ?? "", field.placeholder ?? ""]),
      ...(admin.actions ?? []).map(action => action.label),
      ...(admin.toolbarActions ?? []).map(action => action.label),
    ];
    for (const label of labels) {
      if (!label) continue;
      expect(label, `${view}: ${label}`).not.toMatch(/(?<!客户)(团队|项目)/);
      expect(label, `${view}: ${label}`).not.toContain("客户客户");
    }
  }
  expect(checked).toBeGreaterThan(10);
});
