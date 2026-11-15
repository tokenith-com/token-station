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
	if err := store.db.Exec("INSERT INTO team_wallet_calls (request_id, team_id, reserved_cents, status, created_at) VALUES (?, ?, ?, ?, ?)", "existing", "team", 1, teamWalletCallReserved, time.Now().UTC()).Error; err != nil {
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
	if err := store.db.Create(&teamWalletCall{RequestID: "migrated", TeamID: "team", ReservedCents: 1, ExchangeRate: "7.2", Status: teamWalletCallReserved, CreatedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatalf("insert exchange rate after upgrade: %v", err)
	}
}

func TestTeamWalletSettlement(t *testing.T) {
	for _, tc := range []struct {
		name, rate string
		cost       float64
		want       int64
		wantErr    error
	}{
		{"charge", "7.2", 0.1, 72, nil},
		{"exceeded", "7.2", 1, 0, errTeamWalletSettlementExceeded},
		{"missing rate", "", 0.1, 0, errTeamWalletSettlementInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := NewMemoryStore()
			now := time.Now().UTC()
			if err := store.db.Create(&teamWallet{TeamID: "team", BalanceCents: 1000, UpdatedAt: now}).Error; err != nil {
				t.Fatal(err)
			}
			if err := store.db.Transaction(func(tx *gorm.DB) error { return reserveTeamWalletCall(tx, "team", "request", tc.rate, 100, now) }); err != nil {
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
			if err != nil || wallet.BalanceCents != 1000-tc.want || reservation.Status != wantStatus || reservation.SettledCents != tc.want {
				t.Fatalf("wallet = %+v, reservation = %+v, error = %v", wallet, reservation, err)
			}
		})
	}
}

func TestTeamWalletConversion(t *testing.T) {
	for _, tc := range []struct {
		usd, rate string
		want      int64
	}{
		{"0", "7.2", 0}, {"1.01", "7.2", 728}, {"0.000001", "7.123456", 1}, {"100", "7.25", 72500},
	} {
		got, err := ConvertUSDToCNYCents(tc.usd, tc.rate)
		if err != nil || got != tc.want {
			t.Fatalf("conversion %+v: got %d, %v", tc, got, err)
		}
	}
	for _, tc := range [][2]string{{"1", "0"}, {"1", "NaN"}, {"-1", "7"}, {"1e3", "7"}, {"1", "7.1234567"}, {"999999999999999999", "999999999999999999"}} {
		if _, err := ConvertUSDToCNYCents(tc[0], tc[1]); err == nil {
			t.Fatalf("accepted invalid decimals %v", tc)
		}
	}
}

func TestTeamWalletCreditAtomicAndIdempotent(t *testing.T) {
	store := NewMemoryStore()
	store.CreateResource("teams", AdminResource{ID: "wallet-team"})
	for range 2 {
		if _, err := store.CreditTeamWallet("wallet-team", "credit-1", "admin", 1250); err != nil {
			t.Fatal(err)
		}
	}
	wallet, err := store.TeamWallet("wallet-team")
	if err != nil || wallet.BalanceCents != 1250 {
		t.Fatalf("unexpected wallet: %+v, %v", wallet, err)
	}
	if _, err := store.CreditTeamWallet("wallet-team", "credit-1", "admin", 1300); err == nil {
		t.Fatal("accepted conflicting replay")
	}
	if _, err := store.CreditTeamWallet("missing", "credit-2", "admin", 100); err == nil {
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
	if err != nil || wallet.BalanceCents != 1250 {
		t.Fatalf("failed credit changed balance: %+v, %v", wallet, err)
	}
}

func TestTeamWalletHTTPPermissionsAndSettings(t *testing.T) {
	store := NewMemoryStore()
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
	admin, leader, member, security := session("system_admin"), session("team_leader"), session("user"), session("security_admin")
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
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_cents": 9007199254740992, "request_id": "unsafe-amount", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 400},
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_cents": 500, "request_id": "missing-metadata"}, 400},
		{security, http.MethodPost, walletPath + "/credits", nil, 403},
		{member, http.MethodPost, walletPath + "/credits", nil, 403},
		{leader, http.MethodGet, walletPath, nil, 200},
		{member, http.MethodGet, walletPath, nil, 403},
		{security, http.MethodGet, walletPath, nil, 403},
		{leader, http.MethodGet, "/api/admin/teams/other-wallet-team/wallet", nil, 403},
		{leader, http.MethodPost, walletPath + "/credits", map[string]any{"amount_cents": 500, "request_id": "http-credit", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 403},
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_cents": 500, "request_id": "http-credit", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 200},
		{admin, http.MethodPost, walletPath + "/credits", map[string]any{"amount_cents": 500, "request_id": "http-credit", "credit_type": "offline_receipt", "remark": "Receipt confirmed"}, 200},
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
		resp := doJSON(t, app, http.MethodPost, walletPath+"/credits", map[string]any{"amount_cents": 500, "request_id": "http-credit", "credit_type": metadata.kind, "remark": metadata.remark}, admin)
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
	if response.Code != 200 || ledger.Total != 1 || ledger.Limit != 1 || ledger.Offset != 0 || ledger.Currency != "CNY" || len(ledger.Entries) != 1 || ledger.Entries[0].Remark != "Receipt confirmed" || ledger.Entries[0].BeforeBalanceCents == nil || *ledger.Entries[0].BeforeBalanceCents != 0 || *ledger.Entries[0].AfterBalanceCents != 500 {
		t.Fatalf("unexpected HTTP ledger: %s", response.Body)
	}
	store.CreateResource("teams", AdminResource{ID: "wallet-team", Status: StatusDisabled})
	response = doJSON(t, app, http.MethodGet, walletPath+"/ledger", nil, leader)
	if response.Code != 403 {
		t.Fatalf("inactive team ledger: %d %s", response.Code, response.Body)
	}
	wallet, err := store.TeamWallet("wallet-team")
	if err != nil || wallet.BalanceCents != 500 {
		t.Fatalf("unexpected wallet after HTTP credit: %+v, %v", wallet, err)
	}
}

func TestTeamWalletCreditMetadataMigration(t *testing.T) {
	url := "sqlite://" + filepath.Join(t.TempDir(), "upgrade.db")
	store, err := NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"credit_type", "remark", "before_balance_cents", "after_balance_cents", "actor_name", "team_name"} {
		if err := store.db.Exec("ALTER TABLE team_wallet_entries DROP COLUMN " + column).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := store.db.Exec("DELETE FROM schema_migrations WHERE version = 20").Error; err != nil {
		t.Fatal(err)
	}
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
	if err != nil || total != 1 || len(entries) != 1 || entries[0].CreditType != "legacy" || entries[0].BeforeBalanceCents != nil || entries[0].AfterBalanceCents != nil || entries[0].AmountCents != 100 {
		t.Fatalf("legacy migration: %+v %d %v", entries, total, err)
	}
}

func TestTeamWalletLedgerPersistenceAndConsumption(t *testing.T) {
	url := "sqlite://" + filepath.Join(t.TempDir(), "ledger.db")
	store, err := NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	store.CreateResource("teams", AdminResource{ID: "team", Name: "Original team"})
	entry, err := store.CreditTeamWalletWithMetadata("team", "funding", "admin", 1000, "approved_credit", "  Approved funding  ")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Remark != "Approved funding" || entry.TeamName != "Original team" || *entry.BeforeBalanceCents != 0 || *entry.AfterBalanceCents != 1000 {
		t.Fatalf("credit snapshots: %+v", entry)
	}
	now := time.Now().UTC()
	for i, requestID := range []string{"reserved", "settled", "released"} {
		if err := store.db.Transaction(func(tx *gorm.DB) error {
			if err := reserveTeamWalletCall(tx, "team", requestID, "7.2", 100, now.Add(time.Duration(i)*time.Second)); err != nil {
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
		{"reserved", "reserved", -100, 0}, {"settled", "settled", -72, -72}, {"released", "released", 0, 0}, {"funding", "credited", 1000, 1000},
	} {
		entries, total, err := store.TeamWalletLedger("team", tc.requestID, 50, 0)
		if err != nil || total != 1 || len(entries) != 1 || entries[0].Status != tc.status || entries[0].AmountCents != tc.net || entries[0].ActualAmountCents != tc.actual {
			t.Fatalf("filtered ledger %s: %+v %d %v", tc.requestID, entries, total, err)
		}
	}
	wallet, err := store.TeamWallet("team")
	if err != nil || wallet.BalanceCents != 828 {
		t.Fatalf("balance after calls: %+v %v", wallet, err)
	}
	entries, total, err = store.TeamWalletLedger("other-team", "funding", 50, 0)
	if err != nil || total != 0 || len(entries) != 0 {
		t.Fatalf("cross-team query: %+v %d %v", entries, total, err)
	}
	retry, err := store.CreditTeamWalletWithMetadata("team", "funding", "admin", 1000, "approved_credit", "Approved funding")
	if err != nil || retry.ID != entry.ID || *retry.AfterBalanceCents != 1000 {
		t.Fatalf("persisted retry: %+v %v", retry, err)
	}
}
