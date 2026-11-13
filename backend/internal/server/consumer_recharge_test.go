package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func consumerRechargeSession(t *testing.T, store *GormStore, role string) string {
	t.Helper()
	user, err := store.CreateAdminUser(AdminUser{
		Username: "recharge-" + role,
		Name:     "Recharge " + role,
		Email:    "recharge-" + role + "@tokenhub.local",
		Role:     role,
		Status:   StatusActive,
	}, "recharge123456")
	if err != nil {
		t.Fatal(err)
	}
	_, session, err := store.CreateAdminSession(user.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return session.Token
}

func TestConsumerRechargeSimulatedPaymentCreditsWallet(t *testing.T) {
	store := NewMemoryStore()
	token := consumerRechargeSession(t, store, "guest")
	server := NewWithConfig(store, Config{Environment: "test"})
	t.Cleanup(func() { _ = server.Shutdown(t.Context()) })
	app := server.Handler()

	wallet := doJSON(t, app, http.MethodGet, "/api/admin/consumer/wallet", nil, token)
	if wallet.Code != http.StatusOK {
		t.Fatalf("wallet failed: %d %s", wallet.Code, wallet.Body)
	}
	var walletBody struct {
		BalanceCents     int64 `json:"balance_cents"`
		SimulatedPayment bool  `json:"simulated_payment"`
	}
	if err := json.Unmarshal([]byte(wallet.Body), &walletBody); err != nil {
		t.Fatal(err)
	}
	if walletBody.BalanceCents != 0 || !walletBody.SimulatedPayment {
		t.Fatalf("unexpected initial wallet: %+v", walletBody)
	}

	for _, invalid := range []map[string]any{
		{"amount_cents": 50, "payment_method": "alipay"},
		{"amount_cents": 1000, "payment_method": "paypal"},
	} {
		if response := doJSON(t, app, http.MethodPost, "/api/admin/consumer/recharge-orders", invalid, token); response.Code != http.StatusBadRequest {
			t.Fatalf("invalid order %v accepted: %d %s", invalid, response.Code, response.Body)
		}
	}

	created := doJSON(t, app, http.MethodPost, "/api/admin/consumer/recharge-orders", map[string]any{"amount_cents": 5000, "payment_method": "wechat"}, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("order create failed: %d %s", created.Code, created.Body)
	}
	var createdBody struct {
		Order  consumerRechargeOrder `json:"order"`
		QRCode string                `json:"qr_code"`
	}
	if err := json.Unmarshal([]byte(created.Body), &createdBody); err != nil {
		t.Fatal(err)
	}
	if createdBody.Order.Status != rechargeStatusPending || createdBody.QRCode == "" {
		t.Fatalf("unexpected order: %+v", createdBody)
	}

	payPath := "/api/admin/consumer/recharge-orders/" + createdBody.Order.ID + "/simulate-pay"
	for range 2 {
		paid := doJSON(t, app, http.MethodPost, payPath, nil, token)
		if paid.Code != http.StatusOK {
			t.Fatalf("simulate pay failed: %d %s", paid.Code, paid.Body)
		}
		var paidBody struct {
			Order        consumerRechargeOrder `json:"order"`
			BalanceCents int64                 `json:"balance_cents"`
		}
		if err := json.Unmarshal([]byte(paid.Body), &paidBody); err != nil {
			t.Fatal(err)
		}
		if paidBody.Order.Status != rechargeStatusPaid || paidBody.BalanceCents != 5000 {
			t.Fatalf("paying twice must credit once: %+v", paidBody)
		}
	}

	listed := doJSON(t, app, http.MethodGet, "/api/admin/consumer/recharge-orders", nil, token)
	if listed.Code != http.StatusOK {
		t.Fatalf("list orders failed: %d %s", listed.Code, listed.Body)
	}
	var listedBody struct {
		Orders []consumerRechargeOrder `json:"orders"`
	}
	if err := json.Unmarshal([]byte(listed.Body), &listedBody); err != nil {
		t.Fatal(err)
	}
	if len(listedBody.Orders) != 1 || listedBody.Orders[0].ID != createdBody.Order.ID || listedBody.Orders[0].Status != rechargeStatusPaid {
		t.Fatalf("unexpected order list: %+v", listedBody.Orders)
	}
}

func TestConsumerRechargeRejectsNonConsumersAndOtherUsersOrders(t *testing.T) {
	store := NewMemoryStore()
	guestToken := consumerRechargeSession(t, store, "guest")
	userToken := consumerRechargeSession(t, store, "user")
	server := NewWithConfig(store, Config{Environment: "test"})
	t.Cleanup(func() { _ = server.Shutdown(t.Context()) })
	app := server.Handler()

	if response := doJSON(t, app, http.MethodGet, "/api/admin/consumer/wallet", nil, userToken); response.Code != http.StatusForbidden {
		t.Fatalf("team user must not access consumer wallet: %d", response.Code)
	}
	created := doJSON(t, app, http.MethodPost, "/api/admin/consumer/recharge-orders", map[string]any{"amount_cents": 1000, "payment_method": "alipay"}, guestToken)
	var body struct {
		Order consumerRechargeOrder `json:"order"`
	}
	if err := json.Unmarshal([]byte(created.Body), &body); err != nil {
		t.Fatal(err)
	}
	otherGuest, err := store.CreateAdminUser(AdminUser{Username: "recharge-second-guest", Name: "Second", Email: "second-guest@tokenhub.local", Role: "guest", Status: StatusActive}, "recharge123456")
	if err != nil {
		t.Fatal(err)
	}
	_, otherSession, err := store.CreateAdminSession(otherGuest.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	payPath := "/api/admin/consumer/recharge-orders/" + body.Order.ID + "/simulate-pay"
	if response := doJSON(t, app, http.MethodPost, payPath, nil, otherSession.Token); response.Code != http.StatusNotFound {
		t.Fatalf("other consumer paid someone else's order: %d", response.Code)
	}

	production := NewWithConfig(store, Config{Environment: "production"})
	t.Cleanup(func() { _ = production.Shutdown(t.Context()) })
	if response := doJSON(t, production.Handler(), http.MethodPost, payPath, nil, guestToken); response.Code != http.StatusNotFound {
		t.Fatalf("simulated payment must be disabled outside development: %d", response.Code)
	}
}
