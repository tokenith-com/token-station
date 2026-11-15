package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"tokenhub/backend/internal/payment"
)

func TestRechargeSettingsAndCustomOrder(t *testing.T) {
	testRechargeSettings(t, newTestMemoryStore(t))
}

func testRechargeSettings(t *testing.T, store *GormStore) {
	app := New(store)
	adapter := &paymentTestChannel{}
	app.payments = &paymentService{store: store, config: &payment.Service{Plans: []payment.Plan{{ID: "legacy", Name: "Legacy", AmountFen: 1}}, Channels: map[string]payment.Channel{payment.Wechat: adapter}}}
	t.Cleanup(func() { app.payments = nil; _ = app.Shutdown(context.Background()) })
	session := func(role string) string {
		u, err := store.CreateAdminUser(AdminUser{Username: role, Email: role + "@example.test", Role: role, Status: StatusActive}, "test-password-123")
		if err != nil {
			t.Fatal(err)
		}
		_, s, err := store.CreateAdminSession(u.ID, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return s.Token
	}
	root, buyer, operator := session("system_admin"), session("consumer"), session("admin")
	req := func(method, path, token, body, key string, status int) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, status, w.Body)
		}
		return w
	}
	settings := `{"plans":[{"id":"ten","name":"Ten","amount_fen":1000},{"id":"off","name":"Off","amount_fen":2000,"disabled":true}],"custom_enabled":true,"min_fen":100,"max_fen":5000}`
	req("PUT", "/api/admin/recharge/settings", operator, settings, "", 403)
	req("PUT", "/api/admin/recharge/settings", buyer, settings, "", 403)
	req("POST", "/api/admin/resources/"+paymentSettingsKind, root, `{"id":"checkout"}`, "", 404)
	req("PUT", "/api/admin/recharge/settings", root, settings, "", 200)
	req("PUT", "/api/admin/recharge/settings", root, `{"min_fen":100,"max_fen":1}`, "", 400)
	plans := req("GET", "/api/admin/recharge/plans", buyer, "", "", 200)
	if strings.Contains(plans.Body.String(), `"id":"off"`) {
		t.Fatal("disabled plan exposed")
	}
	for _, body := range []string{
		`{"channel":"wechat","amount_fen":99}`, `{"channel":"wechat","amount_fen":5001}`,
		`{"channel":"wechat","amount_fen":100.5}`, `{"channel":"wechat","plan_id":"off"}`,
		`{"channel":"wechat","plan_id":"ten","amount_fen":100}`,
	} {
		req("POST", "/api/admin/recharge/orders", buyer, body, "invalid", 400)
	}
	body := `{"channel":"wechat","amount_fen":1234}`
	w := req("POST", "/api/admin/recharge/orders", buyer, body, "custom-order", 201)
	var order paymentOrder
	if err := json.Unmarshal(w.Body.Bytes(), &order); err != nil {
		t.Fatal(err)
	}
	if order.AmountFen != 1234 || adapter.order.AmountFen != 1234 {
		t.Fatal("custom amount not preserved")
	}
	req("POST", "/api/admin/recharge/orders", buyer, body, "custom-order", 200)
	req("POST", "/api/admin/recharge/orders", buyer, `{"channel":"wechat","amount_fen":1235}`, "custom-order", 409)
	req("PUT", "/api/admin/recharge/settings", root, strings.Replace(settings, `"custom_enabled":true`, `"custom_enabled":false`, 1), "", 200)
	req("POST", "/api/admin/recharge/orders", buyer, body, "new-custom", 400)
	req("POST", "/api/admin/recharge/orders", buyer, body, "custom-order", 200)
	loaded, err := app.rechargeSettings()
	if err != nil || loaded.CustomEnabled || len(loaded.Plans) != 2 {
		t.Fatalf("persisted settings: %+v %v", loaded, err)
	}
}
