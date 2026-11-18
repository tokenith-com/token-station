package server

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestTeamWalletExchangeRateMigration(t *testing.T) {
	testTeamWalletExchangeRateMigration(t, "sqlite://"+filepath.Join(t.TempDir(), "wallet.db"))
}

func testTeamWalletExchangeRateMigration(t *testing.T, url string) {
	t.Helper()
	store, err := NewStoreWithDialect(url, Config{})
	if err != nil {
		t.Fatal(err)
	}
	if !store.db.Migrator().HasColumn(&teamWalletCall{}, "exchange_rate") {
		t.Fatal("fresh schema is missing exchange_rate")
	}
	// Recreate the schema immediately before the exchange-rate migration.
	if err := store.db.Exec("ALTER TABLE team_wallet_calls DROP COLUMN exchange_rate").Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Exec("INSERT INTO team_wallet_calls (request_id, team_id, reserved_micros, status, created_at) VALUES (?, ?, ?, ?, ?)", "existing", "team", 1, teamWalletCallReserved, time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Exec("DELETE FROM schema_migrations WHERE version = 19").Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, err := store.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = NewStoreWithDialect(url, Config{})
	if err != nil {
		t.Fatalf("upgrade existing wallet schema: %v", err)
	}
	t.Cleanup(func() { db, _ := store.db.DB(); _ = db.Close() })
	if !store.db.Migrator().HasColumn(&teamWalletCall{}, "exchange_rate") {
		t.Fatal("upgraded schema is missing exchange_rate")
	}
	var existing teamWalletCall
	if err := store.db.First(&existing, "request_id = ?", "existing").Error; err != nil {
		t.Fatal(err)
	}
	if existing.ExchangeRate != "" {
		t.Fatalf("existing call exchange rate = %q, want an empty default", existing.ExchangeRate)
	}
	if err := store.db.Create(&teamWalletCall{RequestID: "migrated", TeamID: "team", ReservedMicros: 1, ExchangeRate: "7.2", Status: teamWalletCallReserved, CreatedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatalf("insert exchange rate after upgrade: %v", err)
	}
}

func TestTeamWalletSettlement(t *testing.T) {
	for _, tc := range []struct {
		name    string
		cost    float64
		want    int64
		wantErr error
	}{
		{"charge", 0.1, 100000, nil},
		{"exceeded", 1.5, 0, errTeamWalletSettlementExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := NewMemoryStore()
			now := time.Now().UTC()
			if err := store.db.Create(&teamWallet{TeamID: "team", BalanceMicros: 10_000_000, UpdatedAt: now}).Error; err != nil {
				t.Fatal(err)
			}
			if err := store.db.Transaction(func(tx *gorm.DB) error {
				return reserveTeamWalletCall(tx, "team", "request", walletSettlementRate, 1_000_000, now)
			}); err != nil {
				t.Fatal(err)
			}
			call := CallContext{RequestID: "request", TeamWalletEnabled: true, StartedAt: now}
			err := store.db.Transaction(func(tx *gorm.DB) error {
				return settleTeamWalletCall(tx, call, Usage{CostUSD: tc.cost}, true, now)
			})
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("settlement error = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErr != nil {
				for range 2 {
					store.FinishCall(call, RouteSelection{}, Usage{CostUSD: tc.cost}, http.StatusOK, "", "", "")
				}
				var logs []RequestLog
				if err := store.db.Where("request_id = ?", call.RequestID).Find(&logs).Error; err != nil || len(logs) != 1 || logs[0].ErrorCode != AsHTTPError(tc.wantErr).Code || logs[0].StatusCode != http.StatusConflict {
					t.Fatalf("settlement failure logs = %+v, error = %v", logs, err)
				}
				var count int64
				if err := store.db.Model(&UsageRecord{}).Where("request_id = ?", call.RequestID).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("failed settlement wrote usage: count = %d, error = %v", count, err)
				}
			}
			var reservation teamWalletCall
			if err := store.db.First(&reservation, "request_id = ?", call.RequestID).Error; err != nil {
				t.Fatal(err)
			}
			wantStatus := teamWalletCallSettled
			if tc.wantErr != nil {
				wantStatus = teamWalletCallFailed
			}
			wallet, err := store.TeamWallet("team")
			if err != nil || wallet.BalanceMicros != 10_000_000-tc.want || reservation.Status != wantStatus || reservation.SettledMicros != tc.want {
				t.Fatalf("wallet = %+v, reservation = %+v, error = %v", wallet, reservation, err)
			}
		})
	}
}

func TestTeamWalletConversion(t *testing.T) {
	// Wallet amounts allow at most six fractional digits, which is exactly the
	// micro precision, so every accepted amount converts to a whole number of
	// micros and both rounding modes agree.
	for _, tc := range []struct {
		name     string
		usd      string
		halfEven int64
		ceil     int64
	}{
		{"0", "0", 0, 0},
		{"1.01", "1.01", 1_010_000, 1_010_000},
		{"0.000001", "0.000001", 1, 1},
		{"100", "100", 100_000_000, 100_000_000},
		{"0.003459", "0.003459", 3459, 3459},
	} {
		got, err := ConvertUSDToMicros(tc.usd, false)
		if err != nil || got != tc.halfEven {
			t.Fatalf("half-even conversion %+v: got %d, %v", tc, got, err)
		}
		ceil, err := ConvertUSDToMicros(tc.usd, true)
		if err != nil || ceil != tc.ceil {
			t.Fatalf("ceil conversion %+v: got %d, %v", tc, ceil, err)
		}
	}
	for _, usd := range []string{"NaN", "-1", "1e3", "0.0000001", "999999999999999999"} {
		if _, err := ConvertUSDToMicros(usd, false); err == nil {
			t.Fatalf("accepted invalid decimal %q", usd)
		}
	}
}

func TestTeamWalletConversionAppliesExchangeRate(t *testing.T) {
	// The settlement settings page still records an exchange rate even though
	// charging no longer applies it; keep validating that input.
	for _, tc := range []struct{ usd, rate string }{{"1", "0"}, {"1", "NaN"}, {"-1", "7"}, {"1e3", "7"}, {"1", "7.1234567"}} {
		if _, err := ConvertUSDToCNYMicros(tc.usd, tc.rate, false); err == nil {
			t.Fatalf("accepted invalid decimals %v", tc)
		}
	}
	if got, err := ConvertUSDToCNYMicros("1", "7.3", false); err != nil || got != 7_300_000 {
		t.Fatalf("rate conversion: got %d, %v", got, err)
	}
}

func TestTeamWalletCreditAtomicAndIdempotent(t *testing.T) {
	store := NewMemoryStore()
	store.CreateResource("teams", AdminResource{ID: "wallet-team"})
	for range 2 {
		if _, err := store.CreditTeamWallet("wallet-team", "credit-1", "admin", 12_500_000); err != nil {
			t.Fatal(err)
		}
	}
	wallet, err := store.TeamWallet("wallet-team")
	if err != nil || wallet.BalanceMicros != 12_500_000 {
		t.Fatalf("unexpected wallet: %+v, %v", wallet, err)
	}
	if _, err := store.CreditTeamWallet("wallet-team", "credit-1", "admin", 13_000_000); err == nil {
		t.Fatal("accepted conflicting replay")
	}
	if _, err := store.CreditTeamWallet("missing", "credit-2", "admin", 1_000_000); err == nil {
		t.Fatal("credited missing team")
	}
	if _, err := store.CreditTeamWallet("wallet-team", "credit-2", "admin", -1); err == nil {
		t.Fatal("accepted negative credit")
	}
	if _, err := store.CreditTeamWallet("wallet-team", "overflow", "admin", math.MaxInt64); err == nil {
		t.Fatal("accepted balance overflow")
	}
	var count int64
	if err := store.db.Model(&teamWalletEntry{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("unexpected ledger count: %d, %v", count, err)
	}
	wallet, err = store.TeamWallet("wallet-team")
	if err != nil || wallet.BalanceMicros != 12_500_000 {
		t.Fatalf("failed credit changed balance: %+v, %v", wallet, err)
	}
}

func TestTeamWalletHTTPPermissionsAndSettings(t *testing.T) {
	config := Config{Environment: "test", BootstrapAdminPassword: "team-wallet-bootstrap-password"}
	store := NewMemoryStoreWithConfig(config)
	if err := seedDefaultOrgResources(store); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	store.CreateResource("teams", AdminResource{ID: "wallet-team"})
	store.CreateResource("teams", AdminResource{ID: "other-wallet-team"})
	session := func(role string) string {
		user, err := store.CreateAdminUser(AdminUser{Username: "wallet-" + role, Email: "wallet-" + role + "@example.test", Role: role, TeamID: "wallet-team", Status: StatusActive}, "wallet123456")
		if err != nil {
			t.Fatal(err)
		}
		_, token, err := store.CreateAdminSession(user.ID, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return token.Token
	}
	admin, leader, member, security := session("admin"), session("team_leader"), session("user"), session("security_admin")
	server := NewWithConfig(store, Config{Environment: "test"})
	t.Cleanup(func() { _ = server.Shutdown(t.Context()) })
	app := server.Handler()
	ratePath := "/api/admin/team-wallet/exchange-rate"
	walletPath := "/api/admin/teams/wallet-team/wallet"
	for _, tc := range []struct {
		token, method, path string
		body                map[string]any
		want                int
	}{
		{admin, http.MethodGet, ratePath, nil, 200},
		{leader, http.MethodGet, ratePath, nil, 403},
		{security, http.MethodPut, ratePath, map[string]any{"usd_to_cny": "7.2"}, 403},
		{admin, http.MethodPut, ratePath, map[string]any{"usd_to_cny": "0"}, 400},
		{admin, http.MethodPut, ratePath, map[string]any{"usd_to_cny": "7.123456"}, 200},
		{admin, http.MethodGet, walletPath + "/ledger", nil, 200},
		{leader, http.MethodGet, walletPath + "/ledger", nil, 200},
		{member, http.MethodGet, walletPath + "/ledger", nil, 403},
		{security, http.MethodGet, walletPath + "/ledger", nil, 403},
		{leader, http.MethodGet, "/api/admin/teams/other-wallet-team/wallet/ledger", nil, 403},
		{"", http.MethodGet, walletPath + "/ledger", nil, 401},
		{admin, http.MethodGet, walletPath + "/ledger?limit=0", nil, 400},
		{admin, http.MethodGet, walletPath + "/ledger?offset=-1", nil, 400},
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_micros": 9007199254740992, "request_id": "unsafe-amount", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 400},
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_micros": 5_000_000, "request_id": "missing-metadata"}, 400},
		{security, http.MethodPost, walletPath + "/credits", nil, 403},
		{member, http.MethodPost, walletPath + "/credits", nil, 403},
		{leader, http.MethodGet, walletPath, nil, 200},
		{member, http.MethodGet, walletPath, nil, 403},
		{security, http.MethodGet, walletPath, nil, 403},
		{leader, http.MethodGet, "/api/admin/teams/other-wallet-team/wallet", nil, 403},
		{leader, http.MethodPost, walletPath + "/credits", map[string]any{"amount_micros": 5_000_000, "request_id": "http-credit", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 403},
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_micros": 5_000_000, "request_id": "http-credit", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 200},
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_micros": 5_000_000, "request_id": "http-credit", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 200},
	} {
		response := doJSON(t, app, tc.method, tc.path, tc.body, tc.token)
		if response.Code != tc.want {
			t.Fatalf("%s %s: want %d got %d %s", tc.method, tc.path, tc.want, response.Code, response.Body)
		}
	}
	response := doJSON(t, app, http.MethodGet, ratePath, nil, admin)
	var body struct {
		Rate       string `json:"usd_to_cny"`
		Enabled    bool   `json:"paid_calls_enabled"`
		Configured bool   `json:"configured"`
	}
	if err := json.Unmarshal([]byte(response.Body), &body); err != nil {
		t.Fatal(err)
	}
	if body.Rate != "7.123456" || !body.Configured || !body.Enabled {
		t.Fatalf("unexpected rate settings: %+v", body)
	}
	for _, metadata := range []struct {
		kind, remark string
		status       int
	}{
		{"legacy", "Receipt confirmed", 400},
		{"offline_receipt", "   ", 400},
		{"offline_receipt", strings.Repeat("x", 1001), 400},
		{"approved_credit", "Receipt confirmed", 409},
		{"offline_receipt", "Changed remark", 409},
		{"offline_receipt", "  Receipt confirmed  ", 200},
	} {
		resp := doJSON(t, app, http.MethodPost, walletPath+"/credits", map[string]any{"amount_micros": 5_000_000, "request_id": "http-credit", "credit_type": metadata.kind, "remark": metadata.remark}, admin)
		if resp.Code != metadata.status {
			t.Fatalf("metadata %+v: %d %s", metadata, resp.Code, resp.Body)
		}
	}
	response = doJSON(t, app, http.MethodGet, walletPath+"/ledger?request_id=http-credit&limit=1", nil, leader)
	var ledger struct {
		Entries  []teamWalletLedgerEntry `json:"entries"`
		Total    int64                   `json:"total"`
		Limit    int                     `json:"limit"`
		Offset   int                     `json:"offset"`
		Currency string                  `json:"currency"`
	}
	if err := json.Unmarshal([]byte(response.Body), &ledger); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || ledger.Total != 1 || ledger.Limit != 1 || ledger.Offset != 0 || ledger.Currency != "USD" || len(ledger.Entries) != 1 || ledger.Entries[0].Remark != "Receipt confirmed" || ledger.Entries[0].BeforeBalanceMicros == nil || *ledger.Entries[0].BeforeBalanceMicros != 0 || *ledger.Entries[0].AfterBalanceMicros != 5_000_000 {
		t.Fatalf("unexpected HTTP ledger: %s", response.Body)
	}
	store.CreateResource("teams", AdminResource{ID: "wallet-team", Status: StatusDisabled})
	response = doJSON(t, app, http.MethodGet, walletPath+"/ledger", nil, leader)
	if response.Code != 403 {
		t.Fatalf("inactive team ledger: %d %s", response.Code, response.Body)
	}
	wallet, err := store.TeamWallet("wallet-team")
	if err != nil || wallet.BalanceMicros != 5_000_000 {
		t.Fatalf("unexpected wallet after HTTP credit: %+v, %v", wallet, err)
	}
}

// rewindTeamWalletToCents restores the cent column names written by versions
// 18–24 and drops the recorded versions so the next start replays them.
func rewindTeamWalletToCents(t *testing.T, store *GormStore, versions ...int64) {
	t.Helper()
	rewind := map[string][]string{
		"team_wallets":        {"balance"},
		"team_wallet_entries": {"amount", "before_balance", "after_balance"},
		"team_wallet_calls":   {"reserved", "settled", "reserved_before_balance", "reserved_after_balance", "finalized_before_balance", "finalized_after_balance"},
	}
	for table, bases := range rewind {
		present := map[string]bool{}
		var columns []struct{ Name string }
		if err := store.db.Raw("SELECT name FROM pragma_table_info(?)", table).Scan(&columns).Error; err != nil {
			t.Fatal(err)
		}
		for _, column := range columns {
			present[column.Name] = true
		}
		for _, base := range bases {
			micros, cents := base+"_micros", base+"_cents"
			if !present[micros] || present[cents] {
				continue
			}
			for _, statement := range []string{
				"ALTER TABLE " + table + " RENAME COLUMN " + micros + " TO " + cents,
				"UPDATE " + table + " SET " + cents + " = " + cents + " / 10000",
			} {
				if err := store.db.Exec(statement).Error; err != nil {
					t.Fatalf("%s: %v", statement, err)
				}
			}
		}
	}
	for _, version := range versions {
		if err := store.db.Exec("DELETE FROM schema_migrations WHERE version = ?", version).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestTeamWalletCreditMetadataMigration(t *testing.T) {
	url := "sqlite://" + filepath.Join(t.TempDir(), "upgrade.db")
	store, err := NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"credit_type", "remark", "before_balance_micros", "after_balance_micros", "actor_name", "team_name"} {
		if err := store.db.Exec("ALTER TABLE team_wallet_entries DROP COLUMN " + column).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Rewind to the version 19 shape: migration 20 recreates the metadata
	// columns with their legacy defaults and version 25 rescales the ledger.
	rewindTeamWalletToCents(t, store, 20, 25)
	if err := store.db.Exec(`INSERT INTO team_wallet_entries (id, team_id, request_id, amount_cents, actor_user_id, created_at) VALUES ('legacy', 'team', 'old-credit', 100, 'admin', ?)`, time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	db, _ := store.db.DB()
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db, _ := store.db.DB(); _ = db.Close() })
	entries, total, err := store.TeamWalletLedger("team", "old-credit", 50, 0)
	if err != nil || total != 1 || len(entries) != 1 || entries[0].CreditType != "legacy" || entries[0].BeforeBalanceMicros != nil || entries[0].AfterBalanceMicros != nil || entries[0].AmountMicros != 1_000_000 {
		t.Fatalf("legacy migration: %+v %d %v", entries, total, err)
	}
}

// TestTeamWalletMicrosMigration rewinds a database to the cent ledger written
// by versions 18–24 and verifies version 25 rescales it to micros in place.
func TestTeamWalletMicrosMigration(t *testing.T) {
	url := "sqlite://" + filepath.Join(t.TempDir(), "micros.db")
	store, err := NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := store.db.Create(&teamWallet{TeamID: "team", BalanceMicros: 8_280_000, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Create(&teamWalletEntry{ID: "entry", TeamID: "team", RequestID: "credit", AmountMicros: 10_000_000, ActorUserID: "admin", CreatedAt: now, CreditType: "offline_receipt", Remark: "Receipt"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Create(&teamWalletCall{RequestID: "call", TeamID: "team", ReservedMicros: 1_000_000, SettledMicros: 720_000, ExchangeRate: "7.2", Status: teamWalletCallSettled, CreatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	before := int64(0)
	after := int64(10_000_000)
	if err := store.db.Model(&teamWalletEntry{}).Where("id = ?", "entry").Updates(map[string]any{"before_balance_micros": before, "after_balance_micros": after}).Error; err != nil {
		t.Fatal(err)
	}
	rewindTeamWalletToCents(t, store, 25)
	db, _ := store.db.DB()
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = NewSQLiteStore(url)
	if err != nil {
		t.Fatalf("upgrade cent ledger: %v", err)
	}
	t.Cleanup(func() { db, _ := store.db.DB(); _ = db.Close() })
	wallet, err := store.TeamWallet("team")
	if err != nil || wallet.BalanceMicros != 8_280_000 {
		t.Fatalf("rescaled wallet: %+v %v", wallet, err)
	}
	var entry teamWalletEntry
	if err := store.db.First(&entry, "id = ?", "entry").Error; err != nil || entry.AmountMicros != 10_000_000 || *entry.BeforeBalanceMicros != 0 || *entry.AfterBalanceMicros != 10_000_000 {
		t.Fatalf("rescaled entry: %+v %v", entry, err)
	}
	var call teamWalletCall
	if err := store.db.First(&call, "request_id = ?", "call").Error; err != nil || call.ReservedMicros != 1_000_000 || call.SettledMicros != 720_000 {
		t.Fatalf("rescaled call: %+v %v", call, err)
	}
	// The renamed columns must keep their non-negative balance guard.
	if err := store.db.Model(&teamWallet{}).Where("team_id = ?", "team").Update("balance_micros", -1).Error; err == nil {
		t.Fatal("renamed balance column lost its check constraint")
	}
}

func TestTeamWalletLedgerPersistenceAndConsumption(t *testing.T) {
	url := "sqlite://" + filepath.Join(t.TempDir(), "ledger.db")
	store, err := NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	store.CreateResource("teams", AdminResource{ID: "team", Name: "Original team"})
	entry, err := store.CreditTeamWalletWithMetadata("team", "funding", "admin", 10_000_000, "approved_credit", "  Approved funding  ")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Remark != "Approved funding" || entry.TeamName != "Original team" || *entry.BeforeBalanceMicros != 0 || *entry.AfterBalanceMicros != 10_000_000 {
		t.Fatalf("credit snapshots: %+v", entry)
	}
	now := time.Now().UTC()
	for i, requestID := range []string{"reserved", "settled", "released"} {
		if err := store.db.Transaction(func(tx *gorm.DB) error {
			if err := reserveTeamWalletCall(tx, "team", requestID, walletSettlementRate, 1_000_000, now.Add(time.Duration(i)*time.Second)); err != nil {
				return err
			}
			switch requestID {
			case "settled":
				return settleTeamWalletCall(tx, CallContext{RequestID: requestID, TeamWalletEnabled: true}, Usage{CostUSD: 0.1}, true, now)
			case "released":
				return releaseTeamWalletCall(tx, requestID, now)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	db, _ := store.db.DB()
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db, _ := store.db.DB(); _ = db.Close() })
	entries, total, err := store.TeamWalletLedger("team", "", 2, 1)
	if err != nil || total != 4 || len(entries) != 2 || entries[0].RequestID != "settled" || entries[1].RequestID != "reserved" {
		t.Fatalf("page: %+v total %d err %v", entries, total, err)
	}
	for _, tc := range []struct {
		requestID, status string
		net, actual       int64
	}{
		{"reserved", "reserved", -1_000_000, 0}, {"settled", "settled", -100_000, -100_000}, {"released", "released", 0, 0}, {"funding", "credited", 10_000_000, 10_000_000},
	} {
		entries, total, err := store.TeamWalletLedger("team", tc.requestID, 50, 0)
		if err != nil || total != 1 || len(entries) != 1 || entries[0].Status != tc.status || entries[0].AmountMicros != tc.net || entries[0].ActualAmountMicros != tc.actual {
			t.Fatalf("filtered ledger %s: %+v %d %v", tc.requestID, entries, total, err)
		}
	}
	wallet, err := store.TeamWallet("team")
	if err != nil || wallet.BalanceMicros != 8_900_000 {
		t.Fatalf("balance after calls: %+v %v", wallet, err)
	}
	entries, total, err = store.TeamWalletLedger("other-team", "funding", 50, 0)
	if err != nil || total != 0 || len(entries) != 0 {
		t.Fatalf("cross-team query: %+v %d %v", entries, total, err)
	}
	retry, err := store.CreditTeamWalletWithMetadata("team", "funding", "admin", 10_000_000, "approved_credit", "Approved funding")
	if err != nil || retry.ID != entry.ID || *retry.AfterBalanceMicros != 10_000_000 {
		t.Fatalf("persisted retry: %+v %v", retry, err)
	}
}
