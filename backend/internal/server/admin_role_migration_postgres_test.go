//go:build integration

package server

import "testing"

func TestPostgresCanonicalAdminRoleMigration(t *testing.T) {
	db, pgURL := openPostgresAdmin(t)
	schema := createPostgresSchema(t, db, "tokenstation_admin_role_")
	dsn, err := withSearchPath(pgURL, schema)
	if err != nil {
		t.Fatal(err)
	}
	testCanonicalAdminRoleMigration(t, dsn)
}
