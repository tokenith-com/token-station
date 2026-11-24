import { expect, it } from "vitest";
import { emptyData } from "./catalog";
import { apiKeyAuditLabel, apiKeyAuditParts } from "./entities";

function dataWithKey(ownerUserID: string) {
  const data = emptyData();
  data.users = [
    { id: "usr_member", username: "pt", name: "太湖员工A", email: "pt@locol.com", role: "user", status: "active", team_id: "team_t" },
    { id: "usr_other", username: "p2", name: "太湖员工B", email: "pt2@locol.com", role: "user", status: "active", team_id: "team_t" },
  ] as never;
  data.keys = [{
    id: "key_1", project_id: "prj_t", owner_user_id: ownerUserID, name: "员工A",
    key_prefix: "sk_w43x", key_suffix: "XQZXAh",
  }] as never;
  return data;
}

// A key name alone rarely identifies its owner, so the account follows it in
// every list that shows a key.
it("appends the owning account to the key label", () => {
  const label = apiKeyAuditLabel(dataWithKey("usr_member"), "key_1");
  expect(label).toContain("员工A");
  expect(label).toContain("sk_w43x...XQZXAh");
  expect(label).toContain("太湖员工A / pt@locol.com");
});

it("falls back to the key label when the owner is unknown", () => {
  const label = apiKeyAuditLabel(dataWithKey("usr_missing"), "key_1");
  expect(label).toBe("员工A (sk_w43x...XQZXAh) · usr_missing");
});

it("leaves the label alone for an untracked key id", () => {
  expect(apiKeyAuditLabel(dataWithKey("usr_member"), "key_missing")).toBe("key_missing");
});

it("splits the key label so the account can sit on its own line", () => {
  const parts = apiKeyAuditParts(dataWithKey("usr_member"), "key_1");
  expect(parts.key).toBe("员工A (sk_w43x...XQZXAh)");
  expect(parts.account).toBe("太湖员工A / pt@locol.com");
});

it("omits the account part when the owner is unknown", () => {
  const parts = apiKeyAuditParts(dataWithKey("usr_missing"), "key_1");
  expect(parts.account).toBe("usr_missing");
  expect(apiKeyAuditParts(dataWithKey("usr_member"), "key_missing").account).toBe("");
});
