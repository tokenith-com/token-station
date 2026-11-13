package server

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tokenhub/backend/internal/dbschema"
	"tokenhub/backend/internal/payment"
)

const (
	paymentRefundPending     = "refund_pending"
	paymentRefunded          = "refunded"
	paymentReconcileInterval = time.Minute
)

type paymentOrder struct {
	OrderNo          string  `gorm:"primaryKey" json:"order_no"`
	UserID           string  `json:"user_id"`
	PlanID           string  `json:"plan_id"`
	Subject          string  `json:"subject"`
	Channel          string  `json:"channel"`
	APIMethod        string  `json:"api_method,omitempty"`
	Merchant         string  `json:"-"`
	AmountFen        int64   `json:"amount_fen"`
	Currency         string  `json:"currency"`
	Status           string  `json:"status"`
	TradeNo          *string `json:"trade_no,omitempty"`
	QRCode           string  `gorm:"column:qr_code" json:"qr_code,omitempty"`
	PayURL           string  `gorm:"column:pay_url" json:"pay_url,omitempty"`
	IdempotencyKey   string  `json:"-"`
	CreatedAt        int64   `gorm:"autoCreateTime:false" json:"created_at"`
	ExpiresAt        int64   `json:"expires_at"`
	PaidAt           int64   `json:"paid_at,omitempty"`
	NextCheckAt      int64   `json:"-"`
	PrepayLeaseUntil int64   `json:"-"`
}

func (paymentOrder) TableName() string { return "payment_orders" }

type userWallet struct {
	UserID     string `gorm:"primaryKey" json:"user_id"`
	Currency   string `gorm:"primaryKey" json:"currency"`
	BalanceFen int64  `json:"balance_fen"`
	FrozenFen  int64  `json:"frozen_fen"`
	UpdatedAt  int64  `gorm:"autoUpdateTime:false" json:"updated_at,omitempty"`
}

func (userWallet) TableName() string { return "user_wallets" }

type walletTransaction struct {
	ID              string `gorm:"primaryKey" json:"id"`
	UserID          string `json:"-"`
	Currency        string `json:"currency"`
	Kind            string `json:"type"`
	AmountFen       int64  `json:"amount_fen"`
	BalanceAfterFen int64  `json:"balance_after_fen"`
	OrderNo         string `json:"order_no"`
	CreatedAt       int64  `gorm:"autoCreateTime:false" json:"created_at"`
}

func (walletTransaction) TableName() string { return "wallet_transactions" }

type paymentRefund struct {
	RefundNo         string `gorm:"primaryKey" json:"refund_no"`
	OrderNo          string `json:"order_no"`
	AmountFen        int64  `json:"amount_fen"`
	Status           string `json:"status"`
	ProviderRefundNo string `json:"provider_refund_no,omitempty"`
	ActorID          string `json:"actor_id"`
	Reason           string `json:"reason"`
	CreatedAt        int64  `gorm:"autoCreateTime:false" json:"created_at"`
	CompletedAt      int64  `json:"completed_at,omitempty"`
	NextCheckAt      int64  `json:"-"`
	SubmittedAt      int64  `json:"-"`
	SubmitLeaseUntil int64  `json:"-"`
}

func (paymentRefund) TableName() string { return "payment_refunds" }

func paymentMigration() dbschema.Migration {
	return dbschema.Migration{Version: 12, Name: "add-direct-payments-and-wallets", StatementBudget: 12, Statements: []string{
		`CREATE TABLE IF NOT EXISTS payment_orders (
   order_no text PRIMARY KEY, user_id text NOT NULL, plan_id text NOT NULL, subject text NOT NULL,
   channel text NOT NULL, merchant text NOT NULL, amount_fen bigint NOT NULL CHECK (amount_fen > 0),
   currency text NOT NULL, status text NOT NULL, trade_no text, qr_code text NOT NULL,
   idempotency_key text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, paid_at bigint NOT NULL,
   next_check_at bigint NOT NULL, prepay_lease_until bigint NOT NULL,
   UNIQUE (user_id, idempotency_key), UNIQUE (channel, merchant, trade_no)
  )`,
		`CREATE INDEX IF NOT EXISTS idx_payment_orders_user_time ON payment_orders (user_id, created_at, order_no)`,
		`CREATE INDEX IF NOT EXISTS idx_payment_orders_reconcile ON payment_orders (status, next_check_at)`,
		`CREATE TABLE IF NOT EXISTS user_wallets (
   user_id text NOT NULL, currency text NOT NULL, balance_fen bigint NOT NULL CHECK (balance_fen >= 0),
   frozen_fen bigint NOT NULL CHECK (frozen_fen >= 0 AND frozen_fen <= balance_fen), updated_at bigint NOT NULL,
   PRIMARY KEY (user_id, currency)
  )`,
		`CREATE TABLE IF NOT EXISTS wallet_transactions (
   id text PRIMARY KEY, user_id text NOT NULL, currency text NOT NULL, kind text NOT NULL,
   amount_fen bigint NOT NULL, balance_after_fen bigint NOT NULL CHECK (balance_after_fen >= 0),
   order_no text NOT NULL REFERENCES payment_orders (order_no), created_at bigint NOT NULL,
   UNIQUE (order_no, kind)
  )`,
		`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_time ON wallet_transactions (user_id, created_at, id)`,
		`CREATE TABLE IF NOT EXISTS payment_refunds (
   refund_no text PRIMARY KEY, order_no text NOT NULL UNIQUE REFERENCES payment_orders (order_no),
   amount_fen bigint NOT NULL CHECK (amount_fen > 0), status text NOT NULL, provider_refund_no text NOT NULL,
   actor_id text NOT NULL, reason text NOT NULL, created_at bigint NOT NULL, completed_at bigint NOT NULL,
   next_check_at bigint NOT NULL, submit_lease_until bigint NOT NULL, submitted_at bigint NOT NULL
  )`,
		`CREATE INDEX IF NOT EXISTS idx_payment_refunds_reconcile ON payment_refunds (status, next_check_at)`,
	}}
}

func paymentCheckoutMigration() dbschema.Migration {
	return dbschema.Migration{Version: 13, Name: "add-payment-checkout-method-and-url", StatementBudget: 3, Statements: []string{
		`ALTER TABLE payment_orders ADD COLUMN api_method text NOT NULL DEFAULT ''`,
		`ALTER TABLE payment_orders ADD COLUMN pay_url text NOT NULL DEFAULT ''`,
		`UPDATE payment_orders SET api_method = 'alipay.trade.precreate' WHERE channel = 'alipay'`,
	}}
}

func (s *GormStore) paymentOrder(ctx context.Context, orderNo, userID string) (paymentOrder, error) {
	var order paymentOrder
	query := s.db.WithContext(ctx).Where("order_no = ?", orderNo)
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	err := query.Take(&order).Error
	return order, err
}

func (s *GormStore) paymentOrderByKey(ctx context.Context, userID, key string) (paymentOrder, error) {
	var order paymentOrder
	err := s.db.WithContext(ctx).Where("user_id = ? AND idempotency_key = ?", userID, key).Take(&order).Error
	return order, err
}

func (s *GormStore) savePaymentOrder(ctx context.Context, order paymentOrder) (paymentOrder, error) {
	err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "idempotency_key"}}, DoNothing: true,
	}).Create(&order).Error
	if err != nil {
		return paymentOrder{}, err
	}
	return s.paymentOrderByKey(ctx, order.UserID, order.IdempotencyKey)
}

func (s *GormStore) settlePayment(ctx context.Context, order paymentOrder, result payment.OrderResult) error {
	if result.Status != payment.Succeeded || result.OrderNo != order.OrderNo ||
		result.TradeNo == "" || len(result.TradeNo) > 128 || result.AmountFen != order.AmountFen {
		return NewHTTPError(409, "payment_mismatch", "Channel payment does not match the order")
	}
	now := time.Now().Unix()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		changed := tx.Model(&paymentOrder{}).Where("order_no = ? AND status IN ?", order.OrderNo, []string{payment.Pending, payment.Closed}).
			Updates(map[string]any{"status": payment.Succeeded, "trade_no": result.TradeNo, "paid_at": now, "qr_code": "", "pay_url": ""})
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected == 0 {
			var latest paymentOrder
			if err := tx.Where("order_no = ?", order.OrderNo).Take(&latest).Error; err != nil {
				return err
			}
			if latest.TradeNo != nil && *latest.TradeNo == result.TradeNo {
				return nil
			}
			return NewHTTPError(409, "payment_mismatch", "Channel transaction differs from the settled order")
		}
		wallet := userWallet{UserID: order.UserID, Currency: order.Currency}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&wallet).Error; err != nil {
			return err
		}
		if err := tx.Model(&wallet).Where("user_id = ? AND currency = ?", order.UserID, order.Currency).
			Updates(map[string]any{"balance_fen": gorm.Expr("balance_fen + ?", order.AmountFen), "updated_at": now}).Error; err != nil {
			return err
		}
		return createWalletTransaction(tx, order, "recharge", order.AmountFen, now)
	})
}

func createWalletTransaction(tx *gorm.DB, order paymentOrder, kind string, fen, now int64) error {
	var wallet userWallet
	if err := tx.Where("user_id = ? AND currency = ?", order.UserID, order.Currency).Take(&wallet).Error; err != nil {
		return err
	}
	return tx.Create(&walletTransaction{ID: NewID("wtx"), UserID: order.UserID, Currency: order.Currency, Kind: kind,
		AmountFen: fen, BalanceAfterFen: wallet.BalanceFen, OrderNo: order.OrderNo, CreatedAt: now}).Error
}

func (s *GormStore) paymentRefund(ctx context.Context, column, value string) (paymentRefund, error) {
	var refund paymentRefund
	err := s.db.WithContext(ctx).Where(clause.Eq{Column: column, Value: value}).Take(&refund).Error
	return refund, err
}

func (s *GormStore) reservePaymentRefund(ctx context.Context, order paymentOrder, actor, reason string) (paymentRefund, error) {
	refund := paymentRefund{RefundNo: "TSR" + order.OrderNo[2:], OrderNo: order.OrderNo, AmountFen: order.AmountFen,
		ActorID: actor, Reason: reason, Status: payment.Pending, CreatedAt: time.Now().Unix()}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		changed := tx.Model(&paymentOrder{}).Where("order_no = ? AND status = ?", order.OrderNo, payment.Succeeded).Update("status", paymentRefundPending)
		if changed.Error != nil {
			return changed.Error
		}
		var existing paymentRefund
		err := tx.Where("order_no = ?", order.OrderNo).Take(&existing).Error
		if err == nil {
			refund = existing
			if changed.RowsAffected == 1 && refund.Status == payment.Failed {
				return NewHTTPError(409, "refund_finalized", "This refund has already reached a final state")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if changed.RowsAffected != 1 {
			return NewHTTPError(409, "order_not_refundable", "Only paid orders can be refunded")
		}
		reserved := tx.Model(&userWallet{}).Where("user_id = ? AND currency = ? AND balance_fen - frozen_fen >= ?", order.UserID, order.Currency, order.AmountFen).
			Updates(map[string]any{"frozen_fen": gorm.Expr("frozen_fen + ?", order.AmountFen), "updated_at": refund.CreatedAt})
		if reserved.Error != nil {
			return reserved.Error
		}
		if reserved.RowsAffected != 1 {
			return NewHTTPError(409, "insufficient_balance", "Available balance is insufficient for a full refund")
		}
		return tx.Create(&refund).Error
	})
	return refund, err
}

func (s *GormStore) settlePaymentRefund(ctx context.Context, order paymentOrder, refund paymentRefund, result payment.RefundResult) error {
	if result.Status != payment.Succeeded && result.Status != payment.Failed {
		return nil
	}
	if result.OrderNo != order.OrderNo || result.RefundNo != refund.RefundNo || order.TradeNo == nil ||
		(result.TradeNo != "" && result.TradeNo != *order.TradeNo) ||
		(result.Status == payment.Succeeded && (result.AmountFen != refund.AmountFen || result.TradeNo == "")) {
		return NewHTTPError(409, "refund_mismatch", "Channel refund does not match the order")
	}
	now := time.Now().Unix()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		orderStatus := payment.Succeeded
		if result.Status == payment.Succeeded {
			orderStatus = paymentRefunded
		}
		// All transactions that touch both rows lock the order before the refund.
		changedOrder := tx.Model(&paymentOrder{}).Where("order_no = ? AND status = ?", order.OrderNo, paymentRefundPending).
			Update("status", orderStatus)
		if changedOrder.Error != nil {
			return changedOrder.Error
		}
		changed := tx.Model(&paymentRefund{}).Where("refund_no = ? AND status = ?", refund.RefundNo, payment.Pending).
			Updates(map[string]any{"status": result.Status, "provider_refund_no": result.ProviderRefundNo, "completed_at": now})
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected == 0 {
			var latest paymentRefund
			if err := tx.Where("refund_no = ?", refund.RefundNo).Take(&latest).Error; err != nil {
				return err
			}
			if changedOrder.RowsAffected == 0 && latest.Status == result.Status {
				return nil
			}
			return errors.New("refund is already settled in a different state")
		}
		if changedOrder.RowsAffected != 1 {
			return errors.New("refund order is not pending settlement")
		}
		updates := map[string]any{"frozen_fen": gorm.Expr("frozen_fen - ?", refund.AmountFen), "updated_at": now}
		if result.Status == payment.Succeeded {
			updates["balance_fen"] = gorm.Expr("balance_fen - ?", refund.AmountFen)
		}
		wallet := tx.Model(&userWallet{}).Where("user_id = ? AND currency = ? AND frozen_fen >= ?", order.UserID, order.Currency, refund.AmountFen).Updates(updates)
		if wallet.Error != nil {
			return wallet.Error
		}
		if wallet.RowsAffected != 1 {
			return errors.New("reserved refund balance is missing")
		}
		if result.Status == payment.Succeeded {
			return createWalletTransaction(tx, order, "refund", -refund.AmountFen, now)
		}
		return nil
	})
}
