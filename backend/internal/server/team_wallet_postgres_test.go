//go:build integration

package server

import "testing"

func TestPostgresTeamWalletExchangeRateMigration(t *testing.T) {
	admin, pgURL := openPostgresAdmin(t)
	schema := createPostgresSchema(t, admin, "tokenhub_team_wallet_rate_")
	dsn, err := withSearchPath(pgURL, schema)
	if err != nil {
		t.Fatal(err)
	}
	testTeamWalletExchangeRateMigration(t, dsn)
}
