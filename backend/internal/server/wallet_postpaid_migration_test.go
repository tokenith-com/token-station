package server

import (
	"context"
	"database/sql"
	"testing"

	"tokenhub/backend/internal/dbschema"
)

type walletPostpaidMigrationExecer struct{ *sql.DB }

func (e walletPostpaidMigrationExecer) QueryRowContext(ctx context.Context, query string, args ...any) dbschema.RowScanner {
	return e.DB.QueryRowContext(ctx, query, args...)
}

func TestWalletPostpaidMigrationRebuildsSQLiteWalletTables(t *testing.T) {
	store := newTestMemoryStore(t)
	db, err := store.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"DROP TABLE wallet_transactions",
		"DROP TABLE user_wallets",
		`CREATE TABLE user_wallets (user_id text NOT NULL, currency text NOT NULL, balance_fen bigint NOT NULL CHECK (balance_fen >= 0), frozen_fen bigint NOT NULL CHECK (frozen_fen >= 0 AND frozen_fen <= balance_fen), balance_micros bigint NOT NULL CHECK (balance_micros >= 0), reserved_usage_micros bigint NOT NULL CHECK (reserved_usage_micros >= 0), updated_at bigint NOT NULL, PRIMARY KEY (user_id, currency))`,
		`CREATE TABLE wallet_transactions (id text PRIMARY KEY, user_id text NOT NULL, currency text NOT NULL, kind text NOT NULL, amount_fen bigint NOT NULL, balance_after_fen bigint NOT NULL CHECK (balance_after_fen >= 0), order_no text NOT NULL REFERENCES payment_orders (order_no), created_at bigint NOT NULL, UNIQUE (order_no, kind))`,
		"CREATE INDEX idx_wallet_transactions_user_time ON wallet_transactions (user_id, created_at, id)",
		"INSERT INTO user_wallets (user_id, currency, balance_fen, frozen_fen, balance_micros, reserved_usage_micros, updated_at) VALUES ('u1', 'CNY', 7, 2, 654321, 1234, 987654321)",
		"INSERT INTO wallet_usage (request_id, user_id, model, rates, rate_id, rate, input_bound, output_bound, reserved_micros, charged_micros, status, created_at, updated_at) VALUES ('legacy', 'u1', 'm', '', '', '', 0, 0, 10, 0, 'reserved', 2, 3)",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateWalletPostpaid(t.Context(), walletPostpaidMigrationExecer{DB: db}); err != nil {
		t.Fatal(err)
	}
	var balanceFen, frozenFen, balanceMicros, reservedMicros, updatedAt int64
	if err := db.QueryRow("SELECT balance_fen, frozen_fen, balance_micros, reserved_usage_micros, updated_at FROM user_wallets WHERE user_id = 'u1'").Scan(&balanceFen, &frozenFen, &balanceMicros, &reservedMicros, &updatedAt); err != nil {
		t.Fatal(err)
	}
	if balanceFen != 7 || frozenFen != 2 || balanceMicros != 654321 || reservedMicros != 1234 || updatedAt != 987654321 {
		t.Fatalf("wallet data changed during rebuild: %d %d %d %d %d", balanceFen, frozenFen, balanceMicros, reservedMicros, updatedAt)
	}
	if _, err := db.Exec("INSERT INTO user_wallets (user_id, currency, balance_fen, frozen_fen, balance_micros, reserved_usage_micros, updated_at) VALUES ('u2', 'CNY', -1, 0, -10000, 0, 1)"); err != nil {
		t.Fatalf("negative wallet balance rejected: %v", err)
	}
	if _, err := db.Exec("INSERT INTO wallet_usage (request_id, user_id, model, rates, rate_id, rate, input_bound, output_bound, reserved_micros, charged_micros, status, created_at, updated_at) VALUES ('r1', 'u1', 'm', '', '', '', 0, 0, 0, 0, 'done', 1, 1)"); err != nil {
		t.Fatal(err)
	}
	var settlementMode string
	if err := db.QueryRow("SELECT settlement_mode FROM wallet_usage WHERE request_id = 'r1'").Scan(&settlementMode); err != nil {
		t.Fatal(err)
	}
	if settlementMode != "prepaid" {
		t.Fatalf("settlement mode = %q, want prepaid", settlementMode)
	}
	var legacyStatus string
	if err := db.QueryRow("SELECT status FROM wallet_usage WHERE request_id = 'legacy'").Scan(&legacyStatus); err != nil {
		t.Fatal(err)
	}
	if legacyStatus != "reserved" {
		t.Fatalf("legacy wallet usage was not preserved: %q", legacyStatus)
	}
	var indexCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_wallet_transactions_user_time'").Scan(&indexCount); err != nil {
		t.Fatal(err)
	}
	if indexCount != 1 {
		t.Fatal("wallet transaction index was not preserved")
	}
}
