//go:build integration

package server

import "testing"

func TestPostgresRechargeSettings(t *testing.T) {
	admin, pgURL := openPostgresAdmin(t)
	schema := createPostgresSchema(t, admin, "tokenhub_recharge_settings_")
	dsn, err := withSearchPath(pgURL, schema)
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewStoreWithDialect(dsn, Config{Environment: "test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	testRechargeSettings(t, store)
}
