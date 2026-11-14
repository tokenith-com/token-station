import type { AppData, AppRole } from "./types";

export type Portal = "b" | "c";

export const portalRoles: Record<Portal, AppRole[]> = {
  b: ["admin", "team_leader", "user"],
  c: ["admin", "consumer"],
};

// Unknown backend roles must not silently become team members.
export function portalRole(role: string): AppRole | null {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "system_admin"].includes(value)) return "admin";
  if (["team_leader", "teamlead", "project_admin"].includes(value)) return "team_leader";
  if (["guest", "individual", "consumer", "retail_user"].includes(value)) return "consumer";
  if (["user", "member", "viewer", "readonly", "read_only"].includes(value)) return "user";
  return null;
}

export function portalAllowsRole(portal: Portal, role: string) {
  const normalized = portalRole(role);
  return normalized !== null && portalRoles[portal].includes(normalized);
}

export function scopePortalData(data: AppData, portal: Portal): AppData {
  return {
    ...data,
    users: data.users.filter(user => portalAllowsRole(portal, user.role)),
    resources: {
      ...data.resources,
      "role-configs": (data.resources["role-configs"] ?? []).filter(role =>
        portalAllowsRole(portal, String(role.fields?.role_key || role.id))),
    },
  };
}
