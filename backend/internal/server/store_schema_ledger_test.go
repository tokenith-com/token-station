package server

import (
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"tokenhub/backend/internal/dbschema"
)

func TestSchemaLedgerBaselineAdoptedAndVerified(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "schema-ledger.db")
	store, err := NewSQLiteStore("sqlite://" + databasePath)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := store.db.DB()
	if err != nil {
		t.Fatal(err)
	}

	// Opening the store records the adoption baseline exactly once.
	var baselineCount int
	if err := sqlDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = ? AND dirty = 0", dbschema.BaselineVersion).Scan(&baselineCount); err != nil {
		t.Fatal(err)
	}
	if baselineCount != 1 {
		t.Fatalf("expected one clean adoption baseline row, got %d", baselineCount)
	}

	// A tampered ledger must refuse the next startup instead of booting on an
	// unverified schema state.
	if _, err := sqlDB.Exec("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = ?", dbschema.BaselineVersion); err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = NewSQLiteStore("sqlite://" + databasePath)
	if err == nil {
		t.Fatal("expected store open to refuse a tampered schema ledger")
	}
	var schemaErr *dbschema.Error
	if !errors.As(err, &schemaErr) || schemaErr.Code != dbschema.ErrCodeChecksumMismatch {
		t.Fatalf("expected checksum_mismatch refusal, got %v", err)
	}
}

func TestSchemaLedgerRejectsConflictingMasterPaymentVersions(t *testing.T) {
	for _, version := range []int{12, 13, 14} {
		t.Run(fmt.Sprintf("version_%d", version), func(t *testing.T) {
			dsn := "sqlite://" + filepath.Join(t.TempDir(), "conflicting-history.db")
			store, err := NewSQLiteStore(dsn)
			if err != nil {
				t.Fatal(err)
			}
			masterMigrations := []dbschema.Migration{consumerEmailActivationMigration(), consumerRechargeMigration(), apiKeyCiphertextMigration()}
			migration := masterMigrations[version-12]
			if err := store.db.Exec("UPDATE schema_migrations SET name = ?, checksum = ? WHERE version = ?", migration.Name, migration.Checksum(), version).Error; err != nil {
				t.Fatal(err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := NewSQLiteStore(dsn)
			if err == nil {
				_ = reopened.Close()
				t.Fatal("conflicting master migration history must not be adopted silently")
			}
			var schemaErr *dbschema.Error
			if !errors.As(err, &schemaErr) || schemaErr.Code != dbschema.ErrCodeChecksumMismatch {
				t.Fatalf("expected checksum_mismatch refusal, got %v", err)
			}
		})
	}
}

func TestSQLiteGranularBillingMigrationBudgetCoversColumnProbes(t *testing.T) {
	const granularBillingColumns = 26
	const minimumOperations = granularBillingColumns * 2 // PRAGMA probe plus ALTER TABLE per column.

	for _, migration := range SchemaMigrationRegistry() {
		if migration.Name != "add-granular-billing-columns-sqlite" {
			continue
		}
		if migration.StatementBudget < minimumOperations {
			t.Fatalf("sqlite granular billing migration statement budget = %d, want at least %d", migration.StatementBudget, minimumOperations)
		}
		return
	}
	t.Fatal("sqlite granular billing migration was not registered")
}
