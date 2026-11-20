import { describe, expect, it } from "vitest";
import { adminNavGroups, appRole, canAccessView, isNavParentItem, navGroupsForUser } from "./navigation";
import type { AdminUser, AppRole } from "./types";

export const expectedMenus: Record<AppRole, string[]> = {
  admin: [
    "overview", "usage", "audit", "reports",
    "providers", "models", "routes", "playground", "routing-policies",
    "projects", "api-keys", "teams", "user-model-access", "approvals",
    "billing", "quota-policies", "cost-centers",
    "monitors", "alerts", "alert-events", "notification-channels", "alert-deliveries",
    "security-policies", "sqlite-backups", "database-status", "announcements", "plugins",
    "users", "role-configs", "identity-providers", "settings", "settlement-settings",
  ],
  team_leader: ["overview", "usage", "models", "playground", "api-keys", "gateway", "users", "user-model-access", "quota-policies", "audit"],
  user: ["overview", "models", "playground", "api-keys", "gateway", "usage", "audit"],
  consumer: ["overview", "models", "playground", "api-keys", "gateway", "usage", "audit", "billing", "balance-recharge"],
};
describe("custom role menus retained during upstream merge", () => {
  it.each(Object.keys(expectedMenus) as AppRole[])("preserves the %s menu and access", role => {
    const user: AdminUser = { id: role, username: role, email: "", name: role, role, status: "active" };
    const views = navGroupsForUser(user).flatMap(g => g.items.flatMap(i => isNavParentItem(i) ? i.children.map(c => c.view) : [i.view]));
    expect(views).toEqual(expectedMenus[role]);
    for (const view of views) expect(canAccessView(user, view)).toBe(true);
    if (role !== "admin") {
      for (const view of ["providers", "routes", "settings", "settlement-settings"] as const) expect(canAccessView(user, view)).toBe(false);
    }
  });

  it.each(["consumer", "guest", " GUEST "])("normalizes consumer role %s", role => {
    expect(appRole(role)).toBe("consumer");
    const user = { role } as AdminUser;
    expect(navGroupsForUser(user)).toEqual(navGroupsForUser({ role: "consumer" } as AdminUser));
    expect(canAccessView(user, "balance-recharge")).toBe(true);
    expect(canAccessView(user, "users")).toBe(false);
  });

  it.each(["team_leader", "teamlead", "project_admin"])("hides projects from the %s menu without removing access", role => {
    const user = { role } as AdminUser;
    const items = navGroupsForUser(user).flatMap(group => group.items);
    expect(items).not.toEqual(expect.arrayContaining([expect.objectContaining({ view: "projects" })]));
    expect(canAccessView(user, "projects")).toBe(true);
  });

  it("retains the custom provider label in the admin navigation", () => {
    const aiResources = adminNavGroups.find((group) => group.title === "AI资源");
    expect(aiResources?.items).toEqual(expect.arrayContaining([expect.objectContaining({ view: "providers", label: "供应商" })]));
  });
});
