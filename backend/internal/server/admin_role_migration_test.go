package server

import (
	"net/http"
	"path/filepath"
	"testing"
	"time"
)

func TestCanonicalAdminRoleMigrationPreservesExistingSessions(t *testing.T) {
	testCanonicalAdminRoleMigration(t, "sqlite://"+filepath.Join(t.TempDir(), "legacy-admin.db"))
}

func testCanonicalAdminRoleMigration(t *testing.T, url string) {
	t.Helper()
	store, err := NewStoreWithDialect(url, Config{Environment: "test"})
	if err != nil {
		t.Fatal(err)
	}
	store.CreateResource("teams", AdminResource{ID: "migration-team", Status: StatusActive})
	legacy := createTestAdminUser(t, store, "legacy-wallet-admin", "admin")
	member := createTestAdminUser(t, store, "wallet-member", "user")
	_, session, err := store.CreateAdminSession(legacy.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.db.Model(&AdminUser{}).Where("id = ?", legacy.ID).UpdateColumn("role", " SYSTEM_ADMIN ").Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Exec("DELETE FROM schema_migrations WHERE version = ?", canonicalAdminRoleVersion).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = NewStoreWithDialect(url, Config{Environment: "test"})
	if err != nil {
		t.Fatalf("apply administrator role migration: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for id, want := range map[string]string{legacy.ID: "admin", member.ID: "user"} {
		var account AdminUser
		if err := store.db.Select("role").First(&account, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		if account.Role != want {
			t.Fatalf("stored role for %s = %q, want %q", id, account.Role, want)
		}
	}
	user, ok := store.ValidateAdminSession(session.Token)
	if !ok || user.ID != legacy.ID || user.Role != "admin" {
		t.Fatalf("existing session did not resolve to the migrated administrator: id=%q role=%q valid=%t", user.ID, user.Role, ok)
	}
	app := New(store)
	t.Cleanup(func() { _ = app.Shutdown(t.Context()) })
	response := doJSON(t, app.Handler(), http.MethodGet, "/api/admin/teams/migration-team/wallet", nil, session.Token)
	if response.Code != http.StatusOK {
		t.Fatalf("migrated administrator cannot read the wallet: %d %s", response.Code, response.Body)
	}
}

func TestAdminAccountWritesStoreCanonicalRole(t *testing.T) {
	store := newTestMemoryStore(t)
	created := createTestAdminUser(t, store, "legacy-role-input", "system_admin")
	member := createTestAdminUser(t, store, "legacy-role-update", "user")
	updated, err := store.UpdateAdminUser(member.ID, AdminUser{Role: " SYSTEM_ADMIN "}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range []AdminUser{created, updated} {
		var stored AdminUser
		if err := store.db.Select("role").First(&stored, "id = ?", account.ID).Error; err != nil {
			t.Fatal(err)
		}
		if account.Role != "admin" || stored.Role != "admin" {
			t.Fatalf("administrator role returned=%q stored=%q, want admin", account.Role, stored.Role)
		}
	}
}
