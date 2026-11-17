package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
)

func rateHistoryActor(t *testing.T, store *GormStore, role string) (AdminUser, string) {
	t.Helper()
	user, err := store.CreateAdminUser(AdminUser{Username: "rate-" + role, Email: "rate-" + role + "@example.test", Name: "Original administrator", Role: role, Status: StatusActive}, "wallet123456")
	if err != nil {
		t.Fatal(err)
	}
	_, session, err := store.CreateAdminSession(user.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return user, session.Token
}

func TestTeamWalletRateHistoryPersistenceAndRollback(t *testing.T) {
	url := "sqlite://" + filepath.Join(t.TempDir(), "history.db")
	store, err := NewSQLiteStore(url)
	if err != nil {
		t.Fatal(err)
	}
	actor, _ := rateHistoryActor(t, store, "system_admin")
	for range 2 {
		entry, err := store.SaveTeamWalletRate("007.123450", actor.ID)
		if err != nil || entry.USDToCNY != "007.123450" || entry.ActorUserID != actor.ID || entry.ActorName != actor.Name || entry.CreatedAt.Location() != time.UTC {
			t.Fatalf("save snapshot: %+v %v", entry, err)
		}
	}
	if err := store.db.Model(&AdminUser{}).Where("id = ?", actor.ID).Update("name", "Renamed administrator").Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Exec(`CREATE TRIGGER reject_rate_history BEFORE INSERT ON team_wallet_rate_history_entries BEGIN SELECT RAISE(ABORT, 'injected history failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveTeamWalletRate("8", actor.ID); err == nil {
		t.Fatal("history failure did not abort save")
	}
	if got, err := teamWalletRate(store.db); err != nil || got != "007.123450" {
		t.Fatalf("current rate changed after rollback: %s %v", got, err)
	}
	if err := store.db.Exec("DROP TRIGGER reject_rate_history").Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Exec(`CREATE TRIGGER reject_rate_setting BEFORE INSERT ON admin_resources BEGIN SELECT RAISE(ABORT, 'injected setting failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveTeamWalletRate("9", actor.ID); err == nil {
		t.Fatal("setting failure did not abort save")
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
	entries, total, err := store.TeamWalletRateHistory(50, 0)
	if err != nil || total != 2 || len(entries) != 2 || entries[0].ActorName != actor.Name || entries[0].USDToCNY != "007.123450" {
		t.Fatalf("persisted history: %+v %d %v", entries, total, err)
	}
	if err := VerifySchemaSemantics(t.Context(), url); err != nil {
		t.Fatal(err)
	}
}

func TestTeamWalletRateHistoryHTTP(t *testing.T) {
	config := Config{Environment: "test", BootstrapAdminPassword: "rate-history-bootstrap-password"}
	store := newTestMemoryStoreWithConfig(t, config)
	if err := seedDefaultOrgResources(store); err != nil {
		t.Fatal(err)
	}
	if err := seedBootstrapAdmin(store, config.BootstrapAdminPassword); err != nil {
		t.Fatal(err)
	}
	actor, admin := rateHistoryActor(t, store, "admin")
	_, leader := rateHistoryActor(t, store, "team_leader")
	_, security := rateHistoryActor(t, store, "security_admin")
	_, member := rateHistoryActor(t, store, "user")
	server := NewWithConfig(store, Config{Environment: "test"})
	t.Cleanup(func() { _ = server.Shutdown(t.Context()) })
	app := server.Handler()
	path := "/api/admin/team-wallet/exchange-rate"
	for _, token := range []string{leader, security, member, ""} {
		resp := doJSON(t, app, http.MethodGet, path+"/history", nil, token)
		want := 403
		if token == "" {
			want = 401
		}
		if resp.Code != want {
			t.Fatalf("history permission: %d %s", resp.Code, resp.Body)
		}
	}
	for _, query := range []string{"limit=0", "limit=-1", "offset=-1", "limit=no", "offset=1.5", "limit=", "offset=", "limit=1&limit=2", "offset=999999999999999999999999"} {
		resp := doJSON(t, app, http.MethodGet, path+"/history?"+query, nil, admin)
		if resp.Code != 400 {
			t.Fatalf("invalid pagination %s: %d %s", query, resp.Code, resp.Body)
		}
	}
	for range 3 {
		resp := doJSON(t, app, http.MethodPut, path, map[string]any{"usd_to_cny": "7.120000"}, admin)
		if resp.Code != 200 {
			t.Fatalf("save: %d %s", resp.Code, resp.Body)
		}
	}
	// Equal timestamps must still have deterministic ID ordering.
	if err := store.db.Model(&teamWalletRateHistoryEntry{}).Where("1 = 1").Update("created_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	all, _, err := store.TeamWalletRateHistory(50, 0)
	if err != nil || len(all) != 3 || all[0].ID <= all[1].ID || all[1].ID <= all[2].ID {
		t.Fatalf("stable ordering: %+v %v", all, err)
	}
	for _, tc := range []struct {
		query                string
		limit, offset, count int
	}{
		{"", 50, 0, 3}, {"?limit=1&offset=1", 1, 1, 1}, {"?limit=201", 200, 0, 3}, {"?offset=9", 50, 9, 0},
	} {
		resp := doJSON(t, app, http.MethodGet, path+"/history"+tc.query, nil, admin)
		var body struct {
			Entries []teamWalletRateHistoryEntry `json:"entries"`
			Total   int64                        `json:"total"`
			Limit   int                          `json:"limit"`
			Offset  int                          `json:"offset"`
		}
		if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
			t.Fatal(err)
		}
		if resp.Code != 200 || body.Total != 3 || body.Limit != tc.limit || body.Offset != tc.offset || body.Entries == nil || len(body.Entries) != tc.count {
			t.Fatalf("history page: %d %s", resp.Code, resp.Body)
		}
		if tc.count > 0 && (body.Entries[0].ID != all[tc.offset].ID || body.Entries[0].ActorUserID != actor.ID || body.Entries[0].ActorName != actor.Name || body.Entries[0].USDToCNY != "7.120000") {
			t.Fatalf("history contract: %s", resp.Body)
		}
	}
	for _, kind := range []string{"settings", "teams"} {
		for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodDelete} {
			url := "/api/admin/resources/" + kind
			if method != http.MethodPost {
				url += "/" + teamWalletRateID
			}
			resp := doJSON(t, app, method, url, map[string]any{"id": teamWalletRateID, "name": "Bypass", "fields": map[string]any{"usd_to_cny": "9"}}, admin)
			if resp.Code != 403 {
				t.Fatalf("bypass %s %s: %d %s", method, url, resp.Code, resp.Body)
			}
		}
	}
	if rate, err := teamWalletRate(store.db); err != nil || rate != "7.120000" {
		t.Fatalf("bypass changed rate: %s %v", rate, err)
	}
	_, total, err := store.TeamWalletRateHistory(50, 0)
	if err != nil || total != 3 {
		t.Fatalf("bypass changed history: %d %v", total, err)
	}
}

func TestTeamWalletRateHistoryConcurrentSaves(t *testing.T) {
	store := NewMemoryStore()
	actor, _ := rateHistoryActor(t, store, "system_admin")
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Go(func() {
			rate := fmt.Sprintf("7.%06d", i)
			entry, err := store.SaveTeamWalletRate(rate, actor.ID)
			if err != nil || entry.USDToCNY != rate {
				t.Errorf("concurrent save returned different value: %+v %v", entry, err)
			}
		})
	}
	wg.Wait()
	entries, total, err := store.TeamWalletRateHistory(50, 0)
	if err != nil || total != 12 || len(entries) != 12 {
		t.Fatalf("concurrent history: %+v %d %v", entries, total, err)
	}
	if rate, err := teamWalletRate(store.db); err != nil || rate != entries[0].USDToCNY {
		t.Fatalf("latest history differs from current: %s %v", rate, err)
	}
}

func TestTeamWalletRateSavePreservesReservationSnapshot(t *testing.T) {
	store := NewMemoryStore()
	actor, _ := rateHistoryActor(t, store, "system_admin")
	if _, err := store.SaveTeamWalletRate("7", actor.ID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := store.db.Create(&teamWallet{TeamID: "team", BalanceCents: 10000, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	reserve := func(id string) {
		t.Helper()
		if err := store.db.Transaction(func(tx *gorm.DB) error {
			rate, err := teamWalletRate(tx)
			if err != nil {
				return err
			}
			return reserveTeamWalletCall(tx, "team", id, rate, 1000, now)
		}); err != nil {
			t.Fatal(err)
		}
	}
	reserve("old")
	before, _ := store.TeamWallet("team")
	if _, err := store.SaveTeamWalletRate("8", actor.ID); err != nil {
		t.Fatal(err)
	}
	after, _ := store.TeamWallet("team")
	if before.BalanceCents != after.BalanceCents {
		t.Fatal("saving rate changed balance")
	}
	reserve("new")
	for _, tc := range []struct {
		id, rate string
		charge   int64
	}{{"old", "7", 700}, {"new", "8", 800}} {
		if err := store.db.Transaction(func(tx *gorm.DB) error {
			return settleTeamWalletCall(tx, CallContext{RequestID: tc.id, TeamWalletEnabled: true}, Usage{CostUSD: 1}, true, now)
		}); err != nil {
			t.Fatal(err)
		}
		var call teamWalletCall
		if err := store.db.First(&call, "request_id = ?", tc.id).Error; err != nil || call.ExchangeRate != tc.rate || call.SettledCents != tc.charge {
			t.Fatalf("reservation snapshot: %+v %v", call, err)
		}
	}
	wallet, err := store.TeamWallet("team")
	if err != nil || wallet.BalanceCents != 8500 {
		t.Fatalf("settled balance: %+v %v", wallet, err)
	}
}
