import type { AppData, AppRole } from "./types";

// Unknown backend roles must not silently become team members.
export function supportedAccountRole(role: string): AppRole | null {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "system_admin"].includes(value)) return "admin";
  if (["team_leader", "teamlead", "project_admin"].includes(value)) return "team_leader";
  if (["guest", "individual", "consumer", "retail_user"].includes(value)) return "consumer";
  if (["user", "member", "viewer", "readonly", "read_only"].includes(value)) return "user";
  return null;
}

export function scopeSupportedAccounts(data: AppData): AppData {
  return {
    ...data,
    users: data.users.filter(user => supportedAccountRole(user.role) !== null),
    resources: {
      ...data.resources,
      "role-configs": (data.resources["role-configs"] ?? []).filter(role =>
        supportedAccountRole(String(role.fields?.role_key || role.id)) !== null),
    },
  };
}
