import { expect, it } from "vitest";
import { loadPlanForView } from "./data-loading";
import type { AdminUser } from "./types";

function user(role: string): AdminUser {
  return { id: "test-user", username: "test", name: "Test", email: "test@example.com", role, team_id: "team", status: "active" };
}

// The platform administrator renders the user model access page from this
// console, so the plan must request the resource or the list stays empty.
it.each(["admin", "team_leader"])("loads the user model access resource for %s", (role) => {
  const plan = loadPlanForView(user(role), "user-model-access");
  expect(plan.resources).toContain("user-model-access");
  expect(plan.overview).toBe(true);
  expect(plan.users).toBe(true);
});
