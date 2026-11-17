package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"tokenhub/backend/internal/payment"
)

func TestPrepaidRechargeChatPlaygroundAndRefund(t *testing.T) {
	store := NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	user, err := store.CreateAdminUser(AdminUser{Username: "wallet-buyer", Email: "wallet@example.test", Role: "guest", Status: StatusActive}, "test-password-123")
	if err != nil {
		t.Fatal(err)
	}
	_, session, err := store.CreateAdminSession(user.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	project := store.CreateProject(Project{Name: "Personal", OwnerUserID: user.ID, Status: StatusActive})
	key, secret, err := store.CreateAPIKey(project.ID, APIKey{Name: "Personal key", OwnerUserID: user.ID, Status: StatusActive}, "")
	if err != nil {
		t.Fatal(err)
	}
	model := store.AddModel(Model{Name: "wallet-chat", Modality: "chat", ContextWindow: 100, InputPriceUSDPer1M: 1, OutputPriceUSDPer1M: 2, Status: StatusActive})
	provider := store.AddProvider(Provider{Name: "Wallet mock", Type: ProviderMock, Status: StatusActive, Healthy: true})
	store.AddRoute(ModelRoute{ModelName: model.Name, ProviderModel: model.Name, ProviderID: provider.ID, Status: StatusActive, Weight: 100})
	_, err = store.PublishMeteringExchangeRate(meteringExchangeRate{Currency: "CNY", Rate: "0.125", Source: "Test fixture"})
	if err != nil {
		t.Fatal(err)
	}
	adapter := &paymentTestChannel{}
	app := New(store)
	store.prepaidUsage = true
	app.payments = &paymentService{store: store, config: &payment.Service{PrepaidUsage: true, Plans: []payment.Plan{{ID: "small", Name: "Test recharge", AmountFen: 1}}, Channels: map[string]payment.Channel{payment.Wechat: adapter}}}
	t.Cleanup(func() { app.payments = nil; _ = app.Shutdown(context.Background()) })
	request := func(method, path, token, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "test-wallet-recharge")
		req.Header.Set("X-Test-Verified", "true")
		result := httptest.NewRecorder()
		app.Handler().ServeHTTP(result, req)
		if result.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, result.Code, want, result.Body.String())
		}
		return result
	}
	chat := `{"model":"wallet-chat","max_tokens":50,"messages":[{"role":"user","content":"Hello"}]}`
	playground := strings.TrimSuffix(chat, "}") + `,"api_key_id":"` + key.ID + `"}`
	request(http.MethodPost, "/v1/chat/completions", secret, chat, 402)
	request(http.MethodPost, "/api/admin/playground/chat/stream", session.Token, playground, 402)
	created := request(http.MethodPost, "/api/admin/recharge/orders", session.Token, `{"plan_id":"small","channel":"wechat"}`, 201)
	var order paymentOrder
	if err := json.Unmarshal(created.Body.Bytes(), &order); err != nil {
		t.Fatal(err)
	}
	adapter.order = payment.OrderResult{OrderNo: order.OrderNo, TradeNo: "wallet-recharge", Status: payment.Succeeded, AmountFen: 1}
	request(http.MethodPost, payment.WechatNotifyPath, "", "", 204)
	request(http.MethodPost, payment.WechatNotifyPath, "", "", 204)
	response := request(http.MethodPost, "/v1/chat/completions", secret, chat, 200)
	stream := request(http.MethodPost, "/api/admin/playground/chat/stream", session.Token, playground, 200)
	if !strings.Contains(stream.Body.String(), `"wallet":{"status":"settled","charged_micros":`) {
		t.Fatalf("missing settled receipt: %s", stream.Body.String())
	}
	var entries []walletUsage
	if err := store.db.Where("user_id = ?", user.ID).Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	var paid int64
	if len(entries) != 2 {
		t.Fatalf("want two charges, got %+v", entries)
	}
	for _, entry := range entries {
		if entry.Status != "settled" || entry.ChargedMicros <= 0 || entry.ChargedMicros >= walletMicrosPerFen {
			t.Fatalf("invalid sub-fen settlement: %+v", entry)
		}
		paid += entry.ChargedMicros
	}
	checkWallet := func() {
		t.Helper()
		var wallet userWallet
		if err := store.db.Take(&wallet, "user_id = ?", user.ID).Error; err != nil {
			t.Fatal(err)
		}
		if wallet.BalanceMicros != walletMicrosPerFen-paid || wallet.BalanceFen != 0 || wallet.ReservedUsageMicros != 0 {
			t.Fatalf("unexpected wallet: %+v", wallet)
		}
	}
	checkWallet()
	if err := store.db.Transaction(func(tx *gorm.DB) error {
		return finishWalletUsage(tx, response.Header().Get("x-request-id"), Usage{PromptTokens: 99, CompletionTokens: 49}, time.Now().Unix())
	}); err != nil {
		t.Fatal(err)
	}
	checkWallet()
	order, err = store.paymentOrder(context.Background(), order.OrderNo, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.reservePaymentRefund(context.Background(), order, "operator", "test"); err == nil || AsHTTPError(err).Code != "insufficient_balance" {
		t.Fatalf("full refund should respect sub-fen spending: %v", err)
	}
	request(http.MethodPost, "/v1/embeddings", secret, `{"model":"wallet-chat","input":"hello"}`, 400)
}

func TestPrepaidTeamWalletUsesSinglePayer(t *testing.T) {
	store := newTestMemoryStore(t)
	user, err := store.CreateAdminUser(AdminUser{Username: "team-wallet-buyer", Email: "team-wallet@example.test", Role: "consumer", Status: StatusActive}, "test-password-123")
	if err != nil {
		t.Fatal(err)
	}
	store.CreateResource("teams", AdminResource{ID: "wallet-team", Name: "Wallet team", Status: StatusActive})
	project := store.CreateProject(Project{Name: "Team wallet project", TeamID: "wallet-team", Status: StatusActive})
	key, _, err := store.CreateAPIKey(project.ID, APIKey{Name: "Personal key", OwnerUserID: user.ID, Status: StatusActive}, "")
	if err != nil {
		t.Fatal(err)
	}
	store.AddModel(Model{Name: "team-wallet-chat", Modality: "chat", Status: StatusActive, ContextWindow: 1000, InputPriceUSDPer1M: 1, OutputPriceUSDPer1M: 1})
	if err := store.db.Create(&teamWallet{TeamID: project.TeamID, BalanceCents: 100, UpdatedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "7.2"}})
	store.prepaidUsage = true
	var call CallContext
	if err := store.db.Transaction(func(tx *gorm.DB) error {
		admission, err := store.admitCallTransaction(t.Context(), tx, key, "team-wallet-chat", 100, "single-payer")
		call = admission.call
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if !call.TeamWalletEnabled || call.walletPayer != "" {
		t.Fatalf("expected only team wallet payer, got %+v", call)
	}
	for range 2 {
		store.FinishCall(call, RouteSelection{}, Usage{CostUSD: 0.0001, TotalTokens: 100}, http.StatusOK, "", "", "")
	}
	wallet, err := store.TeamWallet(project.TeamID)
	if err != nil || wallet.BalanceCents != 99 {
		t.Fatalf("expected one team wallet charge: %+v, %v", wallet, err)
	}
	var count int64
	if err := store.db.Model(&walletUsage{}).Where("request_id = ?", call.RequestID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unexpected personal wallet charge: count=%d, err=%v", count, err)
	}
}

func TestConsumerProjectUsesPersonalWalletEvenWithLegacyTeamWallet(t *testing.T) {
	store := newTestMemoryStore(t)
	user, err := store.CreateAdminUser(AdminUser{Username: "consumer-wallet-user", Email: "consumer-wallet@example.test", Role: "consumer", Status: StatusActive}, "test-password-123")
	if err != nil {
		t.Fatal(err)
	}
	store.CreateResource("teams", AdminResource{ID: "legacy-consumer-team", Name: "Legacy consumer team", Status: StatusActive})
	project := store.CreateProject(Project{ID: consumerProjectID, Name: "Consumer Project", TeamID: "legacy-consumer-team", Status: StatusActive})
	key, _, err := store.CreateAPIKey(project.ID, APIKey{Name: "Consumer key", OwnerUserID: user.ID, Status: StatusActive}, "")
	if err != nil {
		t.Fatal(err)
	}
	store.AddModel(Model{Name: "consumer-wallet-chat", Modality: "chat", Status: StatusActive, ContextWindow: 1000, InputPriceUSDPer1M: 1, OutputPriceUSDPer1M: 1})
	if _, err := store.PublishMeteringExchangeRate(meteringExchangeRate{Currency: "CNY", Rate: "0.125", Source: "Test fixture"}); err != nil {
		t.Fatal(err)
	}
	if err := store.db.Create(&teamWallet{TeamID: project.TeamID, BalanceCents: 100, UpdatedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "7.2"}})
	store.prepaidUsage = true
	var call CallContext
	prepaidContext := context.WithValue(t.Context(), prepaidChatContextKey{}, true)
	if err := store.db.Transaction(func(tx *gorm.DB) error {
		admission, err := store.admitCallTransaction(prepaidContext, tx, key, "consumer-wallet-chat", 100, "consumer-personal-payer")
		call = admission.call
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if call.TeamWalletEnabled || call.walletPayer != user.ID {
		t.Fatalf("expected personal consumer wallet payer, got %+v", call)
	}
}

func TestPrepaidReservationsProtectRefundAndRecover(t *testing.T) {
	testPrepaidReservations(t, NewMemoryStore())
}

func testPrepaidReservations(t *testing.T, store *GormStore) {
	t.Helper()
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	now := time.Now().UTC()
	_, err := store.PublishMeteringExchangeRate(meteringExchangeRate{Currency: "CNY", Rate: "0.125", Source: "Test fixture"})
	if err != nil {
		t.Fatal(err)
	}
	now = time.Now().UTC()
	order := paymentOrder{OrderNo: "test-order", UserID: "test-user", PlanID: "test", AmountFen: 1, Currency: payment.Currency, Status: payment.Pending}
	if err := store.db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.settlePayment(ctx, order, payment.OrderResult{OrderNo: order.OrderNo, TradeNo: "trade", AmountFen: 1, Status: payment.Succeeded}); err != nil {
		t.Fatal(err)
	}
	order, err = store.paymentOrder(ctx, order.OrderNo, order.UserID)
	if err != nil {
		t.Fatal(err)
	}
	model := Model{Name: "test-chat", ContextWindow: 100, InputPriceUSDPer1M: 10, OutputPriceUSDPer1M: 1}
	first := CallContext{RequestID: "first", walletPayer: order.UserID, Model: model, StartedAt: now}
	second := first
	second.RequestID = "second"
	if err := store.reserveWalletUsage(ctx, first, 100, 10); err != nil {
		t.Fatal(err)
	}
	if err := store.reserveWalletUsage(ctx, second, 100, 10); err == nil || AsHTTPError(err).Code != "wallet_insufficient_balance" {
		t.Fatalf("second request should be blocked: %v", err)
	}
	if _, err := store.reservePaymentRefund(ctx, order, "operator", "test"); err == nil || AsHTTPError(err).Code != "insufficient_balance" {
		t.Fatalf("refund should respect request reservation: %v", err)
	}
	if err := store.dispatchWalletUsage(ctx, first, RouteSelection{Provider: Provider{Type: ProviderMock}}, 10); err != nil {
		t.Fatal(err)
	}
	if err := store.db.Model(&walletUsage{}).Where("request_id = ?", first.RequestID).Update("updated_at", now.Add(-2*time.Hour).Unix()).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.reconcileWalletUsage(ctx); err != nil {
		t.Fatal(err)
	}
	var entry walletUsage
	if err := store.db.Take(&entry, "request_id = ?", first.RequestID).Error; err != nil || entry.Status != "pending_review" {
		t.Fatalf("dispatched usage must await review: %+v, %v", entry, err)
	}
	if err := store.db.Transaction(func(tx *gorm.DB) error { return updateWalletUsage(tx, entry, "released", 0, now.Unix()) }); err != nil {
		t.Fatal(err)
	}
	if _, err := store.reservePaymentRefund(ctx, order, "operator", "test"); err != nil {
		t.Fatal(err)
	}
}

func TestSQLiteWalletUsageMigration(t *testing.T) {
	testWalletUsageMigration(t, "sqlite://"+filepath.Join(t.TempDir(), "wallet-v13.db"))
}

func testWalletUsageMigration(t *testing.T, dsn string) {
	t.Helper()
	store, err := NewStoreWithDialect(dsn, Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"DROP TABLE wallet_usage",
		"ALTER TABLE user_wallets DROP COLUMN balance_micros",
		"ALTER TABLE user_wallets DROP COLUMN reserved_usage_micros",
		"DELETE FROM schema_migrations WHERE version = 14",
		"INSERT INTO user_wallets (user_id, currency, balance_fen, frozen_fen, updated_at) VALUES ('legacy-wallet','CNY',321,21,0)",
	} {
		if err := store.db.Exec(stmt).Error; err != nil {
			_ = store.Close()
			t.Fatal(err)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	upgraded, err := NewStoreWithDialect(dsn, Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = upgraded.Close() })
	var wallet userWallet
	if err := upgraded.db.Take(&wallet, "user_id = ?", "legacy-wallet").Error; err != nil {
		t.Fatal(err)
	}
	if wallet.BalanceMicros != 3210000 || wallet.availableMicros() != 3000000 || wallet.ReservedUsageMicros != 0 {
		t.Fatalf("invalid migrated wallet: %+v", wallet)
	}
	if err := VerifySchemaSemantics(t.Context(), dsn); err != nil {
		t.Fatal(err)
	}
}
