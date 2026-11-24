import { describe, expect, it } from "vitest";
import { adminNavGroups, isNavParentItem } from "./navigation";

describe("adminNavGroups", () => {
  it("places plugin management under safety operations", () => {
    const aiResources = adminNavGroups.find((group) => group.title === "AI资源");
    const safetyOps = adminNavGroups.find((group) => group.title === "安全运维");

    expect(navGroupViews(aiResources?.items ?? []).includes("plugins")).toBe(false);
    expect(navGroupViews(safetyOps?.items ?? []).includes("plugins")).toBe(true);
    expect(navGroupViews(safetyOps?.items ?? [])).toEqual(expect.arrayContaining(["security-policies", "plugins"]));
  });

  it("groups platform account settings under system settings", () => {
    const systemSettings = adminNavGroups.find((group) => group.title === "系统设置");
    expect(navGroupViews(systemSettings?.items ?? [])).toEqual(
      expect.arrayContaining(["users", "role-configs", "identity-providers", "settings", "settlement-settings"]),
    );
  });

  it("labels the provider entry as suppliers in the admin navigation", () => {
    const aiResources = adminNavGroups.find((group) => group.title === "AI资源");
    expect(aiResources?.items).toEqual(expect.arrayContaining([expect.objectContaining({ view: "providers", label: "供应商" })]));
  });
});

function navGroupViews(items: NonNullable<typeof adminNavGroups[number]>["items"]) {
  return items.flatMap((item) => isNavParentItem(item) ? item.children.map((child) => child.view) : [item.view]);
}
