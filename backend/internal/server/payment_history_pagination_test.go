package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tokenhub/backend/internal/payment"
)

func TestPaymentHistoryPaginationScopesTotalsToCurrentUser(t *testing.T) {
	store := newTestMemoryStore(t)
	app := New(store)
	app.payments = &paymentService{store: store, config: &payment.Service{}}
	t.Cleanup(func() { app.payments = nil; _ = app.Shutdown(context.Background()) })
	user, err := store.CreateAdminUser(AdminUser{Username: "history-buyer", Email: "history@example.test", Role: "consumer", Status: StatusActive}, "synthetic-password")
	if err != nil {
		t.Fatal(err)
	}
	_, session, err := store.CreateAdminSession(user.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 26; i++ {
		owner := user.ID
		if i >= 23 {
			owner = "another-user"
		}
		order := paymentOrder{OrderNo: fmt.Sprintf("order-%02d", i), UserID: owner, IdempotencyKey: fmt.Sprintf("key-%02d", i), AmountFen: 100, Currency: "CNY", Channel: "alipay", Status: "succeeded", CreatedAt: 100}
		usage := walletUsage{RequestID: fmt.Sprintf("request-%02d", i), UserID: owner, Status: "settled", CreatedAt: 100}
		if err := store.db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
		if err := store.db.Create(&usage).Error; err != nil {
			t.Fatal(err)
		}
	}
	record := UsageRecord{ID: "usage-detail", RequestID: "request-22", InputTokens: 11, OutputTokens: 7, TotalTokens: 18, CostUSD: 0.01}
	if err := store.db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/admin/recharge/orders", "/api/admin/wallet/usage"} {
		t.Run(path, func(t *testing.T) {
			seen := map[string]bool{}
			for _, offset := range []int{0, 20, 40} {
				req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("%s?limit=20&offset=%d", path, offset), nil)
				req.Header.Set("Authorization", "Bearer "+session.Token)
				resp := httptest.NewRecorder()
				app.Handler().ServeHTTP(resp, req)
				if resp.Code != 200 {
					t.Fatalf("status %d: %s", resp.Code, resp.Body.String())
				}
				var result struct {
					Total int              `json:"total"`
					Data  []map[string]any `json:"data"`
				}
				if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if result.Total != 23 || len(result.Data) != max(0, min(20, 23-offset)) {
					t.Fatalf("incorrect scoped total or page size: %+v", result)
				}
				for _, row := range result.Data {
					id, _ := row["order_no"].(string)
					if id == "" {
						id, _ = row["request_id"].(string)
					}
					if id == record.RequestID && (row["input_tokens"] != float64(11) || row["output_tokens"] != float64(7) || row["total_tokens"] != float64(18) || row["cost_usd"] != "0.0100000000") {
						t.Fatalf("incorrect usage details: %+v", row)
					}
					if seen[id] {
						t.Fatalf("duplicate row across pages: %s", id)
					}
					seen[id] = true
				}
			}
			if path == "/api/admin/wallet/usage" && !seen[record.RequestID] {
				t.Fatalf("usage detail row missing from pages: %s", record.RequestID)
			}
		})
	}
}
