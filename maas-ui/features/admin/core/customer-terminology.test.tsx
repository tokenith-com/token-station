import { expect, it } from "vitest";
import { navGroupsByRole, sourceTeamLeaderNavGroups, topQuickActionsForUser } from "./navigation";

it("keeps customer terminology in administrator navigation only", () => {
  const admin = JSON.stringify(navGroupsByRole.admin);
  expect(admin).toContain("客户团队");
  expect(admin).toContain("客户项目");
  for (const role of ["team_leader", "user", "consumer", "security"] as const) {
    expect(JSON.stringify(navGroupsByRole[role])).not.toContain("客户团队");
    expect(JSON.stringify(navGroupsByRole[role])).not.toContain("客户项目");
  }
  expect(JSON.stringify(sourceTeamLeaderNavGroups)).not.toContain("客户");
  const quickActions = topQuickActionsForUser({ id: "fixture", username: "leader", name: "Leader", email: "leader@example.test", role: "team_leader", status: "active" });
  expect(quickActions.map(action => action.label)).toContain("项目空间");
  expect(quickActions.map(action => action.label)).toContain("团队报表");
});
