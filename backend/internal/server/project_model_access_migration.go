package server

import (
	"context"
	"fmt"

	"tokenhub/backend/internal/dbschema"
)

func projectExcludedModelsMigration() dbschema.Migration {
	return dbschema.Migration{
		Version:          22,
		Name:             "add-project-excluded-models",
		Go:               addProjectExcludedModels,
		ChecksumOverride: "tokenhub-schema-project-excluded-models-v1",
		StatementBudget:  3,
	}
}

func addProjectExcludedModels(ctx context.Context, db dbschema.MigrationExecer) error {
	var schema string
	if err := db.QueryRowContext(ctx, `SELECT current_schema()`).Scan(&schema); err == nil {
		if _, err := db.ExecContext(ctx, `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "excluded_models" text`); err != nil {
			return fmt.Errorf("add postgres column projects.excluded_models: %w", err)
		}
		return nil
	}
	exists, err := sqliteColumnExists(ctx, db, "projects", "excluded_models")
	if err != nil || exists {
		return err
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE "projects" ADD COLUMN "excluded_models" text`); err != nil {
		return fmt.Errorf("add sqlite column projects.excluded_models: %w", err)
	}
	return nil
}
