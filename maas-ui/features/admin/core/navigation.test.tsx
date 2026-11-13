import { describe, expect, it } from "vitest";
import { adminNavGroups, canAccessView, isNavParentItem, navGroupsForUser } from "./navigation";
import type { AdminUser, AppRole } from "./types";

export const expectedMenus: Record<AppRole, string[]> = {
  admin: [
    "overview", "usage", "audit", "reports",
    "providers", "models", "routes", "playground", "routing-policies",
    "projects", "api-keys", "teams", "approvals",
    "billing", "quota-policies", "cost-centers",
    "monitors", "alerts", "alert-events", "notification-channels", "alert-deliveries",
    "security-policies", "sqlite-backups", "database-status", "announcements", "plugins",
    "users", "role-configs", "identity-providers", "settings",
  ],
  team_leader: ["overview", "usage", "models", "api-keys", "gateway", "projects", "users", "audit"],
  user: ["overview", "models", "playground", "api-keys", "gateway", "usage", "audit"],
  guest: ["overview", "models", "playground", "api-keys", "gateway", "usage", "audit", "billing", "balance-recharge"],
};
describe("custom role menus retained during upstream merge", () => {
  it.each(Object.keys(expectedMenus) as AppRole[])("preserves the %s menu and access", role => {
    const user: AdminUser = { id: role, username: role, email: "", name: role, role, status: "active" };
    const views = navGroupsForUser(user).flatMap(g => g.items.flatMap(i => isNavParentItem(i) ? i.children.map(c => c.view) : [i.view]));
    expect(views).toEqual(expectedMenus[role]);
    for (const view of views) expect(canAccessView(user, view)).toBe(true);
    if (role !== "admin") {
      for (const view of ["providers", "routes", "settings"] as const) expect(canAccessView(user, view)).toBe(false);
    }
  });

  it("retains the custom provider label in the admin navigation", () => {
    const aiResources = adminNavGroups.find((group) => group.title === "AI资源");
    expect(aiResources?.items).toEqual(expect.arrayContaining([expect.objectContaining({ view: "providers", label: "供应商" })]));
  });
});
