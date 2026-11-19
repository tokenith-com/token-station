//go:build integration

package server

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"tokenhub/backend/internal/dbschema"
)

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
				for column, constraint := range map[string]string{
					"frozen_fen":            "user_wallets_frozen_nonnegative",
					"reserved_usage_micros": "user_wallets_reserved_nonnegative",
				} {
					query := "UPDATE " + dbschema.QuoteIdent(schema) + ".user_wallets SET " + dbschema.QuoteIdent(column) + " = -1 WHERE user_id = 'legacy-wallet'"
					_, err := admin.ExecContext(t.Context(), query)
					var pgErr *pgconn.PgError
					if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != constraint {
						t.Fatalf("negative %s after migration replay: got %v, want check violation on %s", column, err, constraint)
					}
				}
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
