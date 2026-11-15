import { describe, expect, it } from "vitest";
import { emptyData } from "../domain/catalog";
import { roleSelectOptions } from "../domain/entities";
import { portalAllowsRole, portalRole, scopePortalData } from "./portal";
import { clearSavedSession, readSavedSession, saveSession } from "./session";
import { sessionStorageKey, type AdminUser } from "./types";

describe("portal boundaries", () => {
  it.each([
    ["admin", true, true], ["system_admin", true, true],
    ["team_leader", true, false], ["project_admin", true, false],
    ["user", true, false], ["guest", false, true], ["consumer", false, true],
    ["unknown", false, false], ["", false, false],
  ])("limits role %s to its deployment", (role, b, c) => {
    expect(portalAllowsRole("b", role)).toBe(b);
    expect(portalAllowsRole("c", role)).toBe(c);
  });

  it.each(["consumer", "guest", " GUEST "])("uses the canonical portal role for %s", role => {
    expect(portalRole(role)).toBe("consumer");
  });

  it("canonicalizes legacy configured role choices", () => {
    const data = emptyData();
    data.resources["role-configs"] = [{ id: "role_guest", kind: "role-configs", name: "C端普通用户", status: "active", fields: { role_key: "guest" } }];
    expect(roleSelectOptions(data, "c")).toEqual([{ value: "consumer", label: "C端普通用户" }]);
  });

  it("scopes accounts and role choices without removing existing model data", () => {
    const data = emptyData();
    data.users = ["admin", "team_leader", "user", "guest"].map(role => ({ id: role, role }) as AdminUser);
    const b = scopePortalData(data, "b");
    const c = scopePortalData(data, "c");
    expect(b.users.map(user => user.role)).toEqual(["admin", "team_leader", "user"]);
    expect(c.users.map(user => user.role)).toEqual(["admin", "guest"]);
    expect(roleSelectOptions(c, "c").map(option => option.value)).toEqual(["admin", "consumer"]);
    expect(c.models).toBe(data.models);
    expect(data.users).toHaveLength(4);
  });

  it("stores separate transient sessions and clears only the current portal", () => {
    const session = { baseURL: "https://backend.example", token: "real-token", user: { id: "admin", role: "admin" } as AdminUser, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    saveSession(session, "b");
    saveSession({ ...session, token: "c-token" }, "c");
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
    localStorage.setItem(sessionStorageKey, JSON.stringify(session));
    expect(readSavedSession("b")?.token).toBe("real-token");
    expect(sessionStorage.getItem(sessionStorageKey)).toBeNull();
    expect(localStorage.getItem(sessionStorageKey)).toBeNull();
    expect(readSavedSession("c")?.token).toBe("c-token");
    clearSavedSession("b");
    expect(readSavedSession("b")).toBeNull();
    expect(readSavedSession("c")?.token).toBe("c-token");
    clearSavedSession("c");
  });
});
