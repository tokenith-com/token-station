//go:build integration

package server

import "testing"

func TestPostgresWalletUsageMigrationAndSettlement(t *testing.T) {
	admin, url := openPostgresAdmin(t)
	for _, name := range []string{"migration", "settlement", "postpaid"} {
		t.Run(name, func(t *testing.T) {
			schema := createPostgresSchema(t, admin, "tokenhub_wallet_")
			dsn, err := withSearchPath(url, schema)
			if err != nil {
				t.Fatal(err)
			}
			if name == "migration" {
				testWalletUsageMigration(t, dsn)
				return
			}
			store, err := NewStoreWithDialect(dsn, Config{})
			if err != nil {
				t.Fatal(err)
			}
			if name == "postpaid" {
				testPostpaidWalletUsage(t, store)
				return
			}
			testPrepaidReservations(t, store)
		})
	}
}
