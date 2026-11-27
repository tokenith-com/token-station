import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewView } from "./overview";
import { emptyData } from "../domain/catalog";
import { usageDashboardAPIKeyRows } from "./overview";

it("does not expose unresolved account IDs in the cost ranking and resolves late directory data", () => {
  const data = emptyData();
  const owner = "usr_aO3cSRQLs-3NK25d";
  data.keys = [{ id: "key-ranking", project_id: "project-ranking", owner_user_id: owner, name: "Application Key", key_prefix: "sk-fixture", key_suffix: "1234", allowed_models: [], status: "active" }];
  data.breakdown.api_keys = [{ id: "key-ranking", request_count: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15, estimated_cost_usd: 0.1 }];
  const missing = usageDashboardAPIKeyRows(data)[0];
  expect(missing.label).toBe("Application Key (sk-fixture...1234)");
  expect(missing.secondaryLabel).toBeUndefined();
  expect(missing.label).not.toContain(owner);
  data.users = [{ id: owner, name: "Fixture Member", username: "fixture", email: "fixture@example.test", role: "user", status: "active" }];
  const resolved = usageDashboardAPIKeyRows(data)[0];
  expect(resolved.primaryLabel).toBe("Application Key (sk-fixture...1234)");
  expect(resolved.secondaryLabel).toBe("Fixture Member / fixture@example.test");
});

it.each(["user", "consumer", "team_leader"])("uses the signed-in %s account without a user directory", role => {
  const data = emptyData();
  const currentUser = { id: "usr_self", name: "Current Member", username: "member", email: "member@example.test", role, status: "active" };
  data.keys = [{ id: "key-self", project_id: "project-self", owner_user_id: currentUser.id, name: "Personal Key", key_prefix: "sk-test", key_suffix: "1234", allowed_models: [], status: "active" }];
  data.breakdown.api_keys = [{ id: "key-self", request_count: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15, estimated_cost_usd: 0.1 }];
  expect(usageDashboardAPIKeyRows(data, currentUser)[0].secondaryLabel).toBe("Current Member / member@example.test");
  render(<OverviewView api={{ baseURL: "/", adminToken: "fixture" }} data={data} user={currentUser} onSelectView={() => {}} />);
  expect(screen.getByText("Current Member / member@example.test", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText(/usr_self/)).not.toBeInTheDocument();
});
