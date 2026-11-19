package server

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tokenhub/backend/internal/dbschema"
	"tokenhub/backend/internal/payment"
)

// Consumer (guest) balance top-up. Payment is simulated: an order is created
// with a mock QR payload and is only marked paid through the development-only
// simulate-pay endpoint. A real payment gateway callback would replace that step.

const (
	rechargeStatusPending = "pending"
	rechargeStatusPaid    = "paid"
	rechargeMinCents      = 100
	rechargeMaxCents      = 5_000_000
	rechargeOrderTTL      = 15 * time.Minute
)

var rechargePackageCents = []int64{1000, 5000, 10000, 20000, 50000, 100000}

var rechargePaymentMethods = map[string]bool{"alipay": true, "wechat": true}

type consumerRechargeOrder struct {
	ID            string     `gorm:"primaryKey" json:"id"`
	UserID        string     `gorm:"index;not null" json:"user_id"`
	AmountCents   int64      `gorm:"not null" json:"amount_cents"`
	PaymentMethod string     `gorm:"not null" json:"payment_method"`
	Status        string     `gorm:"not null" json:"status"`
	ExpiresAt     time.Time  `gorm:"not null" json:"expires_at"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	CreatedAt     time.Time  `gorm:"not null" json:"created_at"`
}

func (consumerRechargeOrder) TableName() string { return "consumer_recharge_orders" }

func consumerRechargeMigration() dbschema.Migration {
	return dbschema.Migration{Version: 16, Name: "add-consumer-recharge", Statements: []string{
		`CREATE TABLE IF NOT EXISTS consumer_wallets (user_id text PRIMARY KEY, balance_cents bigint NOT NULL DEFAULT 0, updated_at timestamp NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS consumer_recharge_orders (id text PRIMARY KEY, user_id text NOT NULL, amount_cents bigint NOT NULL, payment_method text NOT NULL, status text NOT NULL, expires_at timestamp NOT NULL, paid_at timestamp, created_at timestamp NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_consumer_recharge_orders_user_id ON consumer_recharge_orders (user_id)`,
	}, StatementBudget: 3}
}

type consumerRechargeStore interface {
	ConsumerWalletBalance(userID string) (int64, error)
	ConsumerRechargeOrders(userID string) ([]consumerRechargeOrder, error)
	CreateConsumerRechargeOrder(userID string, amountCents int64, method string) (consumerRechargeOrder, error)
	PayConsumerRechargeOrder(userID, orderID string) (consumerRechargeOrder, int64, error)
}

var errRechargeOrderNotFound = NewHTTPError(404, "recharge_order_not_found", "Recharge order not found")

// ConsumerWalletBalance reports the guest account's spendable balance.
// Recharge and charging share one wallet: the amount paid in CNY credits the
// same number of wallet units, so the balance card and the settlement ledger
// always agree.
func (s *GormStore) ConsumerWalletBalance(userID string) (int64, error) {
	return ConsumerWalletBalanceTx(s.db, userID)
}

// ConsumerWalletBalanceTx reads the spendable balance inside a transaction so a
// recharge reports the balance it just credited.
func ConsumerWalletBalanceTx(tx *gorm.DB, userID string) (int64, error) {
	var wallet userWallet
	err := tx.Where("user_id = ? AND currency = ?", userID, payment.Currency).First(&wallet).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return wallet.availableMicros() / walletMicrosPerFen, nil
}

func (s *GormStore) ConsumerRechargeOrders(userID string) ([]consumerRechargeOrder, error) {
	var orders []consumerRechargeOrder
	err := s.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&orders).Error
	return orders, err
}

func (s *GormStore) CreateConsumerRechargeOrder(userID string, amountCents int64, method string) (consumerRechargeOrder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	order := consumerRechargeOrder{
		ID:            NewID("rch"),
		UserID:        userID,
		AmountCents:   amountCents,
		PaymentMethod: method,
		Status:        rechargeStatusPending,
		ExpiresAt:     now.Add(rechargeOrderTTL),
		CreatedAt:     now,
	}
	return order, s.db.Create(&order).Error
}

// PayConsumerRechargeOrder marks a pending order paid and credits the wallet
// in one transaction. Paying an already-paid order is idempotent.
func (s *GormStore) PayConsumerRechargeOrder(userID, orderID string) (consumerRechargeOrder, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var order consumerRechargeOrder
	var balance int64
	err := s.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		err := tx.Where("id = ? AND user_id = ?", orderID, userID).First(&order).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errRechargeOrderNotFound
		}
		if err != nil {
			return err
		}
		if order.Status == rechargeStatusPending {
			if now.After(order.ExpiresAt) {
				return NewHTTPError(409, "recharge_order_expired", "Recharge order has expired")
			}
			order.Status = rechargeStatusPaid
			order.PaidAt = &now
			if err := tx.Save(&order).Error; err != nil {
				return err
			}
			// The amount the payer sent in CNY credits the same number of wallet
			// units, so the charged cost and the funded balance share one unit.
			credited := order.AmountCents * walletMicrosPerFen
			wallet := userWallet{UserID: userID, Currency: payment.Currency}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&wallet).Error; err != nil {
				return err
			}
			if err := tx.Model(&userWallet{}).Where("user_id = ? AND currency = ?", userID, payment.Currency).
				Updates(map[string]any{
					"balance_micros": gorm.Expr("balance_micros + ?", credited),
					"balance_fen":    gorm.Expr("(balance_micros + ?) / ?", credited, walletMicrosPerFen),
					"updated_at":     now.Unix(),
				}).Error; err != nil {
				return err
			}
		}
		current, err := ConsumerWalletBalanceTx(tx, userID)
		if err != nil {
			return err
		}
		balance = current
		return nil
	})
	return order, balance, err
}

// requireConsumer authorizes the request and limits it to guest accounts,
// which are the only accounts with a self-funded balance.
func (s *Server) requireConsumer(w http.ResponseWriter, r *http.Request) (AdminUser, consumerRechargeStore, bool) {
	user, ok := s.authorizeAdminUser(w, r)
	if !ok {
		return AdminUser{}, nil, false
	}
	if !isConsumerRole(user.Role) {
		writeError(w, r, NewHTTPError(403, "admin_forbidden", "Only consumer accounts can recharge a balance"))
		return AdminUser{}, nil, false
	}
	store, ok := s.store.(consumerRechargeStore)
	if !ok {
		writeError(w, r, NewHTTPError(501, "recharge_unavailable", "Balance recharge is not available"))
		return AdminUser{}, nil, false
	}
	return user, store, true
}

func (s *Server) handleConsumerWallet(w http.ResponseWriter, r *http.Request) {
	user, store, ok := s.requireConsumer(w, r)
	if !ok {
		return
	}
	balance, err := store.ConsumerWalletBalance(user.ID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"balance_cents":     balance,
		"currency":          "CNY",
		"packages_cents":    rechargePackageCents,
		"min_amount_cents":  rechargeMinCents,
		"max_amount_cents":  rechargeMaxCents,
		"payment_methods":   []string{"alipay", "wechat"},
		"simulated_payment": isDevEnvironment(s.config.Environment),
	})
}

func (s *Server) handleConsumerRechargeOrders(w http.ResponseWriter, r *http.Request) {
	user, store, ok := s.requireConsumer(w, r)
	if !ok {
		return
	}
	orders, err := store.ConsumerRechargeOrders(user.ID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
}

func (s *Server) handleConsumerRechargeOrderCreate(w http.ResponseWriter, r *http.Request) {
	user, store, ok := s.requireConsumer(w, r)
	if !ok {
		return
	}
	var req struct {
		AmountCents   int64  `json:"amount_cents"`
		PaymentMethod string `json:"payment_method"`
	}
	if err := s.decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if req.AmountCents < rechargeMinCents || req.AmountCents > rechargeMaxCents {
		writeError(w, r, NewHTTPError(400, "invalid_recharge_amount", "Recharge amount must be between 1 and 50000 CNY"))
		return
	}
	method := strings.ToLower(strings.TrimSpace(req.PaymentMethod))
	if !rechargePaymentMethods[method] {
		writeError(w, r, NewHTTPError(400, "invalid_payment_method", "Payment method must be alipay or wechat"))
		return
	}
	order, err := store.CreateConsumerRechargeOrder(user.ID, req.AmountCents, method)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"order":   order,
		"qr_code": "tokenhub-mock-pay://" + method + "/" + order.ID,
	})
}

func (s *Server) handleConsumerRechargeOrderSimulatePay(w http.ResponseWriter, r *http.Request) {
	if !isDevEnvironment(s.config.Environment) {
		writeError(w, r, NewHTTPError(404, "not_found", "Not found"))
		return
	}
	user, store, ok := s.requireConsumer(w, r)
	if !ok {
		return
	}
	order, balance, err := store.PayConsumerRechargeOrder(user.ID, r.PathValue("order_id"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"order": order, "balance_cents": balance})
}
