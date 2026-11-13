package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tokenhub/backend/internal/payment"
)

type paymentTestChannel struct {
	order       payment.OrderResult
	refund      payment.RefundResult
	prepayCalls int
	refundCalls int
}

func (*paymentTestChannel) Merchant() string { return "test-merchant" }
func (c *paymentTestChannel) Prepay(_ context.Context, order, _ string, amount int64, _ time.Time, method string) (payment.Checkout, error) {
	c.prepayCalls++
	c.order = payment.OrderResult{OrderNo: order, TradeNo: "trade-" + order, AmountFen: amount, Status: payment.Succeeded}
	if method == payment.AlipayPagePay {
		return payment.Checkout{PayURL: "https://alipay.example.test/checkout"}, nil
	}
	return payment.Checkout{QRCode: "test-qr"}, nil
}
func (c *paymentTestChannel) Query(context.Context, string) (payment.OrderResult, error) {
	return c.order, nil
}
func (*paymentTestChannel) Close(context.Context, string) error { return nil }
func (c *paymentTestChannel) Notify(r *http.Request) (payment.OrderResult, error) {
	if r.Header.Get("X-Test-Verified") != "true" {
		return payment.OrderResult{}, errors.New("test signature mismatch")
	}
	return c.order, nil
}
func (c *paymentTestChannel) Refund(_ context.Context, order, refund, _ string, fen int64) error {
	c.refundCalls++
	c.refund = payment.RefundResult{OrderNo: order, RefundNo: refund, TradeNo: c.order.TradeNo, AmountFen: fen, Status: payment.Pending}
	return errors.New("channel timeout")
}
func (c *paymentTestChannel) QueryRefund(context.Context, string, string) (payment.RefundResult, error) {
	return c.refund, nil
}

func TestPaymentsRechargeAndAdminRefund(t *testing.T) {
	for _, scenario := range []struct{ channel, method, refundStatus string }{
		{payment.Wechat, "", payment.Succeeded},
		{payment.Alipay, payment.AlipayPrecreate, payment.Succeeded},
		{payment.Alipay, payment.AlipayPagePay, payment.Succeeded},
		{payment.Alipay, payment.AlipayPrecreate, payment.Failed},
	} {
		channel, method, refundStatus := scenario.channel, scenario.method, scenario.refundStatus
		t.Run(channel+"/"+method+"/"+refundStatus, func(t *testing.T) {
			store := NewMemoryStore()
			t.Cleanup(func() { _ = store.Close() })
			adapter := &paymentTestChannel{}
			app := New(store)
			app.payments = &paymentService{store: store, config: &payment.Service{
				Plans:         []payment.Plan{{ID: "small", Name: "Test recharge", AmountFen: 100}},
				Channels:      map[string]payment.Channel{channel: adapter},
				AlipayMethods: []string{payment.AlipayPrecreate, payment.AlipayPagePay},
			}}
			t.Cleanup(func() { app.payments = nil; _ = app.Shutdown(context.Background()) })
			session := func(name, role string) string {
				t.Helper()
				user, err := store.CreateAdminUser(AdminUser{Username: name, Email: name + "@example.test", Role: role, Status: StatusActive}, "test-password-123")
				if err != nil {
					t.Fatal(err)
				}
				_, s, err := store.CreateAdminSession(user.ID, time.Hour)
				if err != nil {
					t.Fatal(err)
				}
				return s.Token
			}
			buyer, other, admin := session("buyer", "guest"), session("other", "guest"), session("operator", "admin")
			request := func(method, path, token, body, key string, verified bool, want int) *httptest.ResponseRecorder {
				t.Helper()
				r := httptest.NewRequest(method, path, strings.NewReader(body))
				r.Header.Set("Authorization", "Bearer "+token)
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Idempotency-Key", key)
				if verified {
					r.Header.Set("X-Test-Verified", "true")
				}
				w := httptest.NewRecorder()
				app.Handler().ServeHTTP(w, r)
				if w.Code != want {
					t.Fatalf("%s %s: status %d, want %d: %s", method, path, w.Code, want, w.Body.String())
				}
				return w
			}
			var order paymentOrder
			create := "/api/admin/recharge/orders"
			body := `{"plan_id":"small","channel":"` + channel + `"}`
			if method == payment.AlipayPagePay {
				body = strings.TrimSuffix(body, "}") + `,"api_method":"` + method + `"}`
			}
			first := request("POST", create, buyer, body, "test-key", false, 201)
			if err := json.Unmarshal(first.Body.Bytes(), &order); err != nil || order.APIMethod != method {
				t.Fatalf("prepay response: %s", first.Body.String())
			}
			if method == payment.AlipayPagePay {
				if order.PayURL != "https://alipay.example.test/checkout" || order.QRCode != "" {
					t.Fatalf("page pay must return only its checkout link: %s", first.Body.String())
				}
				differentMethod := strings.Replace(body, payment.AlipayPagePay, payment.AlipayPrecreate, 1)
				request("POST", create, buyer, differentMethod, "test-key", false, 409)
			} else if order.QRCode != "test-qr" || order.PayURL != "" {
				t.Fatalf("QR payment response: %s", first.Body.String())
			}
			request("POST", create, buyer, body, "test-key", false, 200)
			if adapter.prepayCalls != 1 {
				t.Fatal("same idempotency key must not create a second channel order")
			}
			request("GET", create+"/"+order.OrderNo, other, "", "", false, 404)
			webhook := payment.WechatNotifyPath
			success := 204
			if channel == payment.Alipay {
				webhook, success = payment.AlipayNotifyPath, 200
			}
			request("POST", webhook, "", "", "", false, 400)
			adapter.order.AmountFen = 101
			request("POST", webhook, "", "", "", true, 500)
			adapter.order.AmountFen = 100
			request("POST", webhook, "", "", "", true, success)
			request("POST", webhook, "", "", "", true, success)
			paid := request("GET", create+"/"+order.OrderNo, buyer, "", "", false, 200)
			var paidOrder paymentOrder
			if err := json.Unmarshal(paid.Body.Bytes(), &paidOrder); err != nil ||
				paidOrder.Status != payment.Succeeded || paidOrder.QRCode != "" || paidOrder.PayURL != "" {
				t.Fatalf("paid order must clear its checkout: %s", paid.Body.String())
			}

			checkWallet := func(balance, frozen int64) {
				t.Helper()
				w := request("GET", "/api/admin/wallet", buyer, "", "", false, 200)
				var wallet userWallet
				if err := json.Unmarshal(w.Body.Bytes(), &wallet); err != nil || wallet.BalanceFen != balance || wallet.FrozenFen != frozen {
					t.Fatalf("wallet balance: %s, want %d / %d", w.Body.String(), balance, frozen)
				}
			}
			checkWallet(100, 0)
			refundPath := "/api/admin/payment-orders/" + order.OrderNo + "/refunds"
			request("POST", refundPath, buyer, `{"reason":"test"}`, "", false, 403)
			request("POST", refundPath, "dev_admin_token", `{"reason":"test"}`, "", false, 401)
			pending := request("POST", refundPath, admin, `{"reason":"test"}`, "", false, 202)
			var refund paymentRefund
			if err := json.Unmarshal(pending.Body.Bytes(), &refund); err != nil || refund.RefundNo == "" {
				t.Fatalf("refund response: %s", pending.Body.String())
			}
			checkWallet(100, 100)
			request("POST", refundPath, admin, `{"reason":"test"}`, "", false, 202)
			if adapter.refundCalls != 1 {
				t.Fatal("in-flight refund must reuse its claim")
			}
			adapter.refund.Status = refundStatus
			reconcile := "/api/admin/payment-refunds/" + refund.RefundNo + "/reconcile"
			request("POST", reconcile, admin, "", "", false, 200)
			request("POST", reconcile, admin, "", "", false, 200)
			wantBalance, wantEntries := int64(0), int64(2)
			if refundStatus == payment.Failed {
				wantBalance, wantEntries = 100, 1
			}
			checkWallet(wantBalance, 0)
			var entries int64
			if err := store.db.Model(&walletTransaction{}).Where("order_no = ?", order.OrderNo).Count(&entries).Error; err != nil || entries != wantEntries {
				t.Fatalf("ledger entries: %d, %v", entries, err)
			}
		})
	}
}
