package server

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"tokenhub/backend/internal/dbschema"
)

func walletPostpaidMigration() dbschema.Migration {
	return dbschema.Migration{Version: 23, Name: "allow-postpaid-wallet-settlement", Go: migrateWalletPostpaid, ChecksumOverride: "tokenhub-schema-wallet-postpaid-v1", StatementBudget: 40}
}

func migrateWalletPostpaid(ctx context.Context, db dbschema.MigrationExecer) error {
	var schema string
	if err := db.QueryRowContext(ctx, `SELECT current_schema()`).Scan(&schema); err == nil {
		return migrateWalletPostpaidPostgres(ctx, db)
	}
	return migrateWalletPostpaidSQLite(ctx, db)
}

func migrateWalletPostpaidPostgres(ctx context.Context, db dbschema.MigrationExecer) error {
	if _, err := db.ExecContext(ctx, `ALTER TABLE wallet_usage ADD COLUMN IF NOT EXISTS settlement_mode text NOT NULL DEFAULT 'prepaid'`); err != nil {
		return fmt.Errorf("add wallet_usage.settlement_mode: %w", err)
	}
	for _, table := range []string{"user_wallets", "wallet_transactions"} {
		constraints, err := postgresCheckConstraints(ctx, db, table)
		if err != nil {
			return err
		}
		for _, constraint := range constraints {
			if _, err := db.ExecContext(ctx, fmt.Sprintf(`ALTER TABLE %q DROP CONSTRAINT %q`, table, constraint)); err != nil {
				return fmt.Errorf("drop %s constraint %s: %w", table, constraint, err)
			}
		}
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE user_wallets ADD CONSTRAINT user_wallets_frozen_nonnegative CHECK (frozen_fen >= 0)`); err != nil {
		return fmt.Errorf("restore user_wallets frozen constraint: %w", err)
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE user_wallets ADD CONSTRAINT user_wallets_reserved_nonnegative CHECK (reserved_usage_micros >= 0)`); err != nil {
		return fmt.Errorf("restore user_wallets reserved constraint: %w", err)
	}
	return nil
}

func postgresCheckConstraints(ctx context.Context, db dbschema.MigrationExecer, table string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND rel.relname = $1 AND c.contype = 'c'`, table)
	if err != nil {
		return nil, fmt.Errorf("inspect %s check constraints: %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	var names []string
	for rows.Next() {
		var name, definition string
		if err := rows.Scan(&name, &definition); err != nil {
			return nil, err
		}
		definition = strings.ToLower(strings.ReplaceAll(definition, `"`, ""))
		if (table == "user_wallets" && (strings.Contains(definition, "balance_fen >= 0") || strings.Contains(definition, "balance_micros >= 0") || strings.Contains(definition, "frozen_fen <= balance_fen"))) ||
			(table == "wallet_transactions" && strings.Contains(definition, "balance_after_fen >= 0")) {
			names = append(names, name)
		}
	}
	return names, rows.Err()
}

func migrateWalletPostpaidSQLite(ctx context.Context, db dbschema.MigrationExecer) error {
	if _, err := db.ExecContext(ctx, `ALTER TABLE wallet_usage ADD COLUMN settlement_mode text NOT NULL DEFAULT 'prepaid'`); err != nil {
		if !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return fmt.Errorf("add wallet_usage.settlement_mode: %w", err)
		}
	}
	for _, table := range []string{"user_wallets", "wallet_transactions"} {
		if err := rebuildWalletSQLiteTable(ctx, db, table); err != nil {
			return err
		}
	}
	return nil
}

func rebuildWalletSQLiteTable(ctx context.Context, db dbschema.MigrationExecer, table string) error {
	indexes, err := sqliteTableIndexes(ctx, db, table)
	if err != nil {
		return err
	}
	temp := table + "_postpaid_new"
	var create string
	switch table {
	case "user_wallets":
		create = `CREATE TABLE user_wallets_postpaid_new (user_id text NOT NULL, currency text NOT NULL, balance_fen bigint NOT NULL, frozen_fen bigint NOT NULL CHECK (frozen_fen >= 0), balance_micros bigint NOT NULL DEFAULT 0, reserved_usage_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_usage_micros >= 0), updated_at bigint NOT NULL, PRIMARY KEY (user_id, currency))`
	case "wallet_transactions":
		create = `CREATE TABLE wallet_transactions_postpaid_new (id text PRIMARY KEY, user_id text NOT NULL, currency text NOT NULL, kind text NOT NULL, amount_fen bigint NOT NULL, balance_after_fen bigint NOT NULL, order_no text NOT NULL REFERENCES payment_orders (order_no), created_at bigint NOT NULL, UNIQUE (order_no, kind))`
	default:
		return fmt.Errorf("unsupported wallet table %s", table)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`ALTER TABLE %q RENAME TO %q`, table, table+"_postpaid_old")); err != nil {
		return fmt.Errorf("rename %s: %w", table, err)
	}
	if _, err := db.ExecContext(ctx, create); err != nil {
		return fmt.Errorf("create %s: %w", table, err)
	}
	columns := `user_id, currency, balance_fen, frozen_fen, balance_micros, reserved_usage_micros, updated_at`
	if table == "wallet_transactions" {
		columns = `id, user_id, currency, kind, amount_fen, balance_after_fen, order_no, created_at`
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %q (%s) SELECT %s FROM %q`, temp, columns, columns, table+"_postpaid_old")); err != nil {
		return fmt.Errorf("copy %s: %w", table, err)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`DROP TABLE %q`, table+"_postpaid_old")); err != nil {
		return fmt.Errorf("drop old %s: %w", table, err)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`ALTER TABLE %q RENAME TO %q`, temp, table)); err != nil {
		return fmt.Errorf("rename rebuilt %s: %w", table, err)
	}
	for _, index := range indexes {
		index = strings.Replace(index, table+"_postpaid_old", table, 1)
		if _, err := db.ExecContext(ctx, index); err != nil {
			return fmt.Errorf("restore %s index: %w", table, err)
		}
	}
	return nil
}

func sqliteTableIndexes(ctx context.Context, db dbschema.MigrationExecer, table string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`, table)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var indexes []string
	for rows.Next() {
		var sqlText sql.NullString
		if err := rows.Scan(&sqlText); err != nil {
			return nil, err
		}
		if sqlText.Valid {
			indexes = append(indexes, sqlText.String)
		}
	}
	return indexes, rows.Err()
}
