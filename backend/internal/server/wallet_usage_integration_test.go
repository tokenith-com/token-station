package server

import (
	"context"
	"encoding/json"
	"fmt"
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
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "8"}})
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
	request(http.MethodPost, "/v1/chat/completions", secret, chat, 200)
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
	if len(entries) != 3 {
		t.Fatalf("want three charges, got %+v", entries)
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
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "8"}})
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
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "8"}})
	now := time.Now().UTC()
	order := paymentOrder{OrderNo: "test-order", UserID: "test-user", PlanID: "test", AmountFen: 1, Currency: payment.Currency, Status: payment.Pending}
	if err := store.db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.settlePayment(ctx, order, payment.OrderResult{OrderNo: order.OrderNo, TradeNo: "trade", AmountFen: 1, Status: payment.Succeeded}); err != nil {
		t.Fatal(err)
	}
	order, err := store.paymentOrder(ctx, order.OrderNo, order.UserID)
	if err != nil {
		t.Fatal(err)
	}
	model := Model{Name: "test-chat", ContextWindow: 100, InputPriceUSDPer1M: 10, OutputPriceUSDPer1M: 1}
	first := CallContext{RequestID: "first", walletPayer: order.UserID, Model: model, StartedAt: now}
	second := first
	second.RequestID = "second"
	if err := store.db.Create(&walletUsage{RequestID: first.RequestID, UserID: order.UserID, Model: model.Name, Rates: `{"input":10,"output":1}`, RateID: "test-rate", Rate: "0.125", InputBound: 100, OutputBound: 10, ReservedMicros: 10, SettlementMode: "prepaid", Status: "reserved", CreatedAt: now.Unix(), UpdatedAt: now.Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Model(&userWallet{}).Where("user_id = ?", order.UserID).Update("reserved_usage_micros", 10).Error; err != nil {
		t.Fatal(err)
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

func TestPostpaidWalletUsageAllowsNegativeSettlementAndIsIdempotent(t *testing.T) {
	testPostpaidWalletUsage(t, newTestMemoryStore(t))
}

func testPostpaidWalletUsage(t *testing.T, store *GormStore) {
	t.Helper()
	t.Cleanup(func() { _ = store.Close() })
	userID := "postpaid-user"
	if err := store.db.Create(&userWallet{UserID: userID, Currency: payment.Currency, BalanceMicros: 0, BalanceFen: 0, UpdatedAt: time.Now().Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "8"}})
	now := time.Now().UTC()
	call := CallContext{RequestID: "postpaid-request", walletPayer: userID, Model: Model{Name: "test-chat", ContextWindow: 0, InputPriceUSDPer1M: 10, OutputPriceUSDPer1M: 1}, StartedAt: now}
	if err := store.reserveWalletUsage(t.Context(), call, 1, 1); err != nil {
		t.Fatal(err)
	}
	var admitted walletUsage
	if err := store.db.Take(&admitted, "request_id = ?", call.RequestID).Error; err != nil {
		t.Fatal(err)
	}
	if admitted.SettlementMode != "postpaid" || admitted.ReservedMicros != 0 || admitted.Status != "reserved" {
		t.Fatalf("invalid postpaid admission record: %+v", admitted)
	}
	if err := store.dispatchWalletUsage(t.Context(), call, RouteSelection{Provider: Provider{Type: ProviderMock}}, 1); err != nil {
		t.Fatal(err)
	}
	usage := Usage{PromptTokens: 100, CompletionTokens: 100}
	if err := store.db.Transaction(func(tx *gorm.DB) error { return finishWalletUsage(tx, call.RequestID, usage, time.Now().Unix()) }); err != nil {
		t.Fatal(err)
	}
	var entry walletUsage
	if err := store.db.Take(&entry, "request_id = ?", call.RequestID).Error; err != nil {
		t.Fatal(err)
	}
	if entry.Status != "settled" || entry.ChargedMicros <= 0 {
		t.Fatalf("postpaid usage was not settled: %+v", entry)
	}
	var wallet userWallet
	if err := store.db.Take(&wallet, "user_id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if wallet.BalanceMicros != -entry.ChargedMicros || wallet.BalanceFen != -entry.ChargedMicros/walletMicrosPerFen {
		t.Fatalf("postpaid settlement did not debit below zero: %+v amount=%d", wallet, entry.ChargedMicros)
	}
	balanceAfterFirst := wallet.BalanceMicros
	if err := store.db.Transaction(func(tx *gorm.DB) error { return finishWalletUsage(tx, call.RequestID, usage, time.Now().Unix()) }); err != nil {
		t.Fatal(err)
	}
	if err := store.db.Take(&wallet, "user_id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if wallet.BalanceMicros != balanceAfterFirst {
		t.Fatalf("repeated finish changed wallet balance: before=%d after=%d", balanceAfterFirst, wallet.BalanceMicros)
	}
}

func TestPostpaidWalletUsageBalanceBoundariesAndPendingReview(t *testing.T) {
	store := newTestMemoryStore(t)
	userID := "wallet-boundary-user"
	for _, micros := range []int64{-1, 0, 1} {
		id := fmt.Sprintf("%s-%d", userID, micros)
		if err := store.db.Create(&userWallet{UserID: id, Currency: payment.Currency, BalanceMicros: micros, BalanceFen: 0, UpdatedAt: time.Now().Unix()}).Error; err != nil {
			t.Fatal(err)
		}
		err := store.db.Transaction(func(tx *gorm.DB) error { return checkPersonalWalletBalance(tx, id) })
		if micros < 0 && (err == nil || AsHTTPError(err).Code != "wallet_insufficient_balance") {
			t.Fatalf("negative sub-fen balance should be rejected: %d, %v", micros, err)
		}
		if micros >= 0 && err != nil {
			t.Fatalf("non-negative balance should be admitted: %d, %v", micros, err)
		}
	}
	entry := walletUsage{RequestID: "postpaid-review", SettlementMode: "postpaid", Rates: `{"input":"10","output":"1"}`, Rate: "0.125", Status: "pending_review", InputBound: 1, OutputBound: 1}
	if status, amount := walletUsageCharge(entry, Usage{PromptTokens: 100, CompletionTokens: 100, MeteringInvalid: true}); status != "pending_review" || amount != 0 {
		t.Fatalf("invalid postpaid usage should remain pending review: %s %d", status, amount)
	}
	prepaid := entry
	prepaid.SettlementMode, prepaid.ReservedMicros = "prepaid", 1
	if status, amount := walletUsageCharge(prepaid, Usage{PromptTokens: 100, CompletionTokens: 100}); status != "pending_review" || amount != 0 {
		t.Fatalf("prepaid usage over reservation should remain pending review: %s %d", status, amount)
	}
}

func TestPostpaidWalletUsageSettlesPreparedRecordsAndIgnoresRouteWindow(t *testing.T) {
	store := newTestMemoryStore(t)
	userID := "postpaid-prepared-user"
	if err := store.db.Create(&userWallet{UserID: userID, Currency: payment.Currency, BalanceMicros: 0, BalanceFen: 0, UpdatedAt: time.Now().Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "8"}})
	now := time.Now().UTC()
	model := Model{Name: "prepared-chat", ContextWindow: 0, InputPriceUSDPer1M: 10, OutputPriceUSDPer1M: 1}
	for _, requestID := range []string{"prepared-a", "prepared-b"} {
		call := CallContext{RequestID: requestID, walletPayer: userID, Model: model, StartedAt: now}
		if err := store.reserveWalletUsage(t.Context(), call, 1, 1); err != nil {
			t.Fatal(err)
		}
		if err := store.dispatchWalletUsage(t.Context(), call, RouteSelection{Provider: Provider{Type: ProviderOpenAICompatible}}, 999999); err != nil {
			t.Fatal(err)
		}
	}
	for _, requestID := range []string{"prepared-a", "prepared-b"} {
		if err := store.db.Transaction(func(tx *gorm.DB) error {
			return finishWalletUsage(tx, requestID, Usage{PromptTokens: 100, CompletionTokens: 100}, time.Now().Unix())
		}); err != nil {
			t.Fatal(err)
		}
	}
	var wallet userWallet
	if err := store.db.Take(&wallet, "user_id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if wallet.BalanceMicros >= 0 {
		t.Fatalf("prepared postpaid requests should both debit the wallet: %+v", wallet)
	}
}

func TestPostpaidPreparationPreservesTokenParametersWithoutContextWindow(t *testing.T) {
	store := newTestMemoryStore(t)
	store.CreateResource("settings", AdminResource{ID: teamWalletRateID, Status: StatusActive, Fields: map[string]any{"usd_to_cny": "8"}})
	app := &Server{payments: &paymentService{store: store}}
	for i, raw := range []string{`{"model":"postpaid-chat","messages":[]}`, `{"model":"postpaid-chat","messages":[],"max_completion_tokens":16}`} {
		var request ChatCompletionRequest
		if err := json.Unmarshal([]byte(raw), &request); err != nil {
			t.Fatal(err)
		}
		call := CallContext{RequestID: fmt.Sprintf("prepare-%d", i), walletPayer: "prepare-user", StartedAt: time.Now().UTC(), Model: Model{ID: "postpaid-model", Name: "postpaid-chat", Status: StatusActive, InputPriceUSDPer1M: 1, OutputPriceUSDPer1M: 2}}
		if err := app.reserveChatWallet(t.Context(), call, &request); err != nil {
			t.Fatal(err)
		}
		if request.MaxTokens != 0 || len(request.raw["max_tokens"]) != 0 {
			t.Fatalf("preparation injected a token limit: %+v", request)
		}
		if i == 1 && string(request.raw["max_completion_tokens"]) != "16" {
			t.Fatalf("preparation changed max_completion_tokens: %+v", request.raw)
		}
	}
}

func TestPostpaidRechargeUsesMicrosForBalanceFen(t *testing.T) {
	store := newTestMemoryStore(t)
	order := paymentOrder{OrderNo: "recharge-postpaid", UserID: "recharge-user", PlanID: "test", AmountFen: 1, Currency: payment.Currency, Status: payment.Pending}
	if err := store.db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.db.Create(&userWallet{UserID: order.UserID, Currency: order.Currency, BalanceMicros: -1, BalanceFen: 0, UpdatedAt: time.Now().Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.settlePayment(t.Context(), order, payment.OrderResult{OrderNo: order.OrderNo, TradeNo: "postpaid-recharge-trade", AmountFen: 1, Status: payment.Succeeded}); err != nil {
		t.Fatal(err)
	}
	var wallet userWallet
	if err := store.db.Take(&wallet, "user_id = ?", order.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if wallet.BalanceMicros != walletMicrosPerFen-1 || wallet.BalanceFen != 0 {
		t.Fatalf("recharge used fen addition instead of micros balance: %+v", wallet)
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
		"DELETE FROM schema_migrations WHERE version = 23",
		"INSERT INTO user_wallets (user_id, currency, balance_fen, frozen_fen, balance_micros, reserved_usage_micros, updated_at) VALUES ('legacy-wallet','CNY',321,21,3210000,0,0)",
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
