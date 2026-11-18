package server

import "tokenhub/backend/internal/dbschema"

const canonicalAdminRoleVersion = 26

// canonicalAdminRoleMigration consolidates legacy platform administrators
// without changing account identifiers or the sessions that reference them.
func canonicalAdminRoleMigration() dbschema.Migration {
	return dbschema.Migration{
		Version: canonicalAdminRoleVersion,
		Name:    "canonicalize-platform-admin-role",
		Statements: []string{
			`UPDATE admin_users SET role = 'admin' WHERE LOWER(TRIM(role)) = 'system_admin'`,
		},
	}
}
