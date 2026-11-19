import { expect, it } from "vitest";
import { loadPlanForView } from "./data-loading";
import { type AdminUser } from "./types";

function user(role: string): AdminUser {
  return { id: "test-user", username: "test", name: "Test", email: "test@example.com", role, team_id: "team", status: "active" };
}

it("loads the team leader's authorized models through overview instead of the forbidden admin models endpoint", () => {
  const plan = loadPlanForView(user("team_leader"), "models");
  expect(plan.overview).toBe(true);
  expect(plan.models).toBe(false);
  expect(plan.providers).toBe(false);
  expect(plan.routes).toBe(false);
  expect(plan.providerModels).toBe(false);
});

it("loads authorized projects and models for the ordinary user's playground without internal routes", () => {
  const plan = loadPlanForView(user("user"), "playground");
  expect(plan.overview).toBe(true);
  expect(plan.models).toBe(true);
  expect(plan.routes).toBe(false);
});

it("retains admin model, provider and route loading", () => {
  const plan = loadPlanForView(user("admin"), "models");
  expect(plan.overview).toBe(true);
  expect(plan.models).toBe(true);
  expect(plan.providers).toBe(true);
  expect(plan.routes).toBe(true);
});

it.each(["admin", "team_leader", "user", "guest"])("loads overview statistics and recent requests without plugin dependencies for %s", role => {
  const plan = loadPlanForView(user(role), "overview");
  expect(plan.overview).toBe(true);
  expect(plan.breakdown).toBe(true);
  expect(plan.timeseries).toBe(true);
  expect(plan.keys).toBe(true);
  expect(plan.logs).toBe(true);
  expect(plan.plugins).toBe(false);
  expect(plan.pluginMarketplace).toBe(false);
  expect(plan.pluginChain).toBe(false);
  expect(plan.pluginUI).toBe(false);
  expect(plan.pluginActions).toBe(false);
  expect(plan.pluginBackgroundJobs).toBe(false);
});

it.each(["admin", "team_leader", "user", "guest"])("leaves period-specific usage loading to the 0.10 report components for %s", role => {
  const plan = loadPlanForView(user(role), "usage");
  expect(plan.overview).toBe(true);
  expect(plan.dailyUsage).toBe(false);
  expect(plan.breakdown).toBe(false);
  expect(plan.timeseries).toBe(false);
});
