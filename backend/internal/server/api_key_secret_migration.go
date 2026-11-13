package server

import (
	"context"
	"fmt"

	"tokenhub/backend/internal/dbschema"
)

// apiKeyCiphertextMigration stores an encrypted copy of each newly issued API
// key so administrators can retrieve it again. Keys issued before this column
// existed keep an empty value and must be rotated to become retrievable.
func apiKeyCiphertextMigration() dbschema.Migration {
	return dbschema.Migration{
		Version: 14,
		Name:    "add-api-key-ciphertext",
		Go:      addAPIKeyCiphertext,
		// The dialect probe, the column lookup, and the column itself.
		StatementBudget: 3,
		// Pinned to the checksum of the original single-statement release so
		// databases that already applied it keep verifying.
		ChecksumOverride: "5f1d88ee1c09d6b16645bbc0e46bf28f371d4e2390e9b8c56cfdec4464c67143",
	}
}

// addAPIKeyCiphertext adds api_keys.key_ciphertext only when it is missing, so
// adopting a database whose ledger was reset does not fail on a duplicate column.
func addAPIKeyCiphertext(ctx context.Context, db dbschema.MigrationExecer) error {
	var schema string
	if err := db.QueryRowContext(ctx, `SELECT current_schema()`).Scan(&schema); err == nil {
		if _, err := db.ExecContext(ctx, `ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_ciphertext" text`); err != nil {
			return fmt.Errorf("add postgres column api_keys.key_ciphertext: %w", err)
		}
		return nil
	}
	exists, err := sqliteColumnExists(ctx, db, "api_keys", "key_ciphertext")
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE "api_keys" ADD COLUMN "key_ciphertext" text`); err != nil {
		return fmt.Errorf("add sqlite column api_keys.key_ciphertext: %w", err)
	}
	return nil
}
