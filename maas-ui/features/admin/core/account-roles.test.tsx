import { describe, expect, it } from "vitest";
import { emptyData } from "../domain/catalog";
import { roleSelectOptions } from "../domain/entities";
import { scopeSupportedAccounts, supportedAccountRole } from "./account-roles";
import { clearSavedSession, readSavedSession, saveSession } from "./session";
import { maasSessionStorageKey, sessionStorageKey, type AdminUser } from "./types";

describe("shared MaaS accounts", () => {
  it.each([
    ["admin", "admin"],
    ["team_leader", "team_leader"], ["project_admin", "team_leader"],
    ["user", "user"], ["guest", "consumer"], ["consumer", "consumer"],
    [" GUEST ", "consumer"], ["unknown", null], ["", null],
  ])("resolves role %s independently of the entry point", (role, expected) => {
    expect(supportedAccountRole(role)).toBe(expected);
  });

  it("includes team and individual accounts without changing model data", () => {
    const data = emptyData();
    data.users = ["admin", "team_leader", "user", "guest", "unknown"].map(role => ({ id: role, role }) as AdminUser);
    data.resources["role-configs"] = [
      { id: "role_team", kind: "role-configs", name: "Team member", status: "active", fields: { role_key: "user" } },
      { id: "role_guest", kind: "role-configs", name: "Individual user", status: "active", fields: { role_key: "guest" } },
    ];
    const scoped = scopeSupportedAccounts(data);
    expect(scoped.users.map(user => user.role)).toEqual(["admin", "team_leader", "user", "guest"]);
    expect(roleSelectOptions(scoped)).toEqual([{ value: "user", label: "Team member" }, { value: "consumer", label: "Individual user" }]);
    expect(scoped.models).toBe(data.models);
    expect(data.users).toHaveLength(5);
  });

  it("keeps the deployed transient session and removes old persistent sessions", () => {
    const session = { baseURL: "https://backend.example", token: "real-token", user: { id: "admin", role: "admin" } as AdminUser, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    saveSession(session);
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
    localStorage.setItem(sessionStorageKey, JSON.stringify(session));
    expect(sessionStorage.getItem(maasSessionStorageKey)).not.toBeNull();
    expect(readSavedSession()?.token).toBe("real-token");
    expect(sessionStorage.getItem(sessionStorageKey)).toBeNull();
    expect(localStorage.getItem(sessionStorageKey)).toBeNull();
    clearSavedSession();
    expect(readSavedSession()).toBeNull();
  });
});
