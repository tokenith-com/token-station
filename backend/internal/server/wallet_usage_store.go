package server

import (
	"context"
	"errors"
	"math"
	"math/big"
	"net/http"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tokenhub/backend/internal/dbschema"
	"tokenhub/backend/internal/metering"
	"tokenhub/backend/internal/payment"
)

const walletMicrosPerFen = 10_000

type walletUsage struct {
	RequestID      string `gorm:"primaryKey" json:"request_id"`
	UserID         string `json:"-"`
	Model          string `json:"model"`
	Rates          string `json:"-"`
	RateID         string `json:"exchange_rate_id"`
	Rate           string `json:"usd_per_cny"`
	InputBound     int64  `json:"-"`
	OutputBound    int64  `json:"-"`
	ReservedMicros int64  `json:"reserved_micros"`
	ChargedMicros  int64  `json:"charged_micros"`
	Status         string `json:"status"`
	SettlementMode string `json:"settlement_mode"`
	CreatedAt      int64  `gorm:"autoCreateTime:false" json:"created_at"`
	UpdatedAt      int64  `gorm:"autoUpdateTime:false" json:"updated_at"`
}

func (walletUsage) TableName() string { return "wallet_usage" }

func walletUsageMigration() dbschema.Migration {
	return dbschema.Migration{Version: 14, Name: "add-prepaid-usage", StatementBudget: 6, Statements: []string{
		`ALTER TABLE user_wallets ADD COLUMN balance_micros bigint NOT NULL DEFAULT 0 CHECK (balance_micros >= 0)`,
		`ALTER TABLE user_wallets ADD COLUMN reserved_usage_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_usage_micros >= 0)`,
		`UPDATE user_wallets SET balance_micros = balance_fen * 10000`,
		`CREATE TABLE wallet_usage (
    request_id text PRIMARY KEY, user_id text NOT NULL, model text NOT NULL,
    rates text NOT NULL, rate_id text NOT NULL, rate text NOT NULL,
    input_bound bigint NOT NULL, output_bound bigint NOT NULL,
    reserved_micros bigint NOT NULL, charged_micros bigint NOT NULL,
    status text NOT NULL, created_at bigint NOT NULL, updated_at bigint NOT NULL
  )`,
		`CREATE INDEX idx_wallet_usage_user_time ON wallet_usage (user_id, created_at, request_id)`,
		`CREATE INDEX idx_wallet_usage_recovery ON wallet_usage (status, updated_at, request_id)`,
	}}
}

func walletUsageError() error {
	return NewHTTPError(http.StatusBadRequest, "prepaid_route_unsupported", "This model or request is unavailable for prepaid usage")
}

func checkPersonalWalletBalance(tx *gorm.DB, userID string) error {
	wallet := userWallet{UserID: userID, Currency: payment.Currency}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&wallet).Error; err != nil {
		return err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&wallet, "user_id = ? AND currency = ?", userID, payment.Currency).Error; err != nil {
		return err
	}
	if wallet.BalanceMicros < 0 {
		return insufficientWalletBalance()
	}
	return nil
}

func insufficientWalletBalance() error {
	return NewHTTPError(http.StatusPaymentRequired, "wallet_insufficient_balance", "Available wallet balance is insufficient for this request")
}

func walletMicros(usd, usdPerCNY string, roundUp bool) (int64, error) {
	amount, err := metering.Decimal(usd)
	if err != nil {
		return 0, err
	}
	rate, err := metering.Decimal(usdPerCNY)
	if err != nil || rate.Sign() <= 0 {
		return 0, errors.New("invalid CNY settlement rate")
	}
	amount.Quo(amount, rate)
	amount.Mul(amount, big.NewRat(1_000_000, 1))
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(amount.Num(), amount.Denom(), remainder)
	twice := new(big.Int).Lsh(remainder, 1)
	comparison := twice.Cmp(amount.Denom())
	if (roundUp && remainder.Sign() > 0) || (!roundUp && (comparison > 0 || comparison == 0 && quotient.Bit(0) == 1)) {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsInt64() {
		return 0, errors.New("prepaid amount overflows wallet precision")
	}
	return quotient.Int64(), nil
}

// loadWalletSettlementFX returns the exchange rate recorded for wallet usage
// entries. Settlement no longer converts, so the rate is the fixed identity:
// wallets are denominated in the same unit as model cost.
func loadWalletSettlementFX(tx *gorm.DB) (*meteringExchangeRate, error) {
	var setting AdminResource
	err := tx.Where("id = ? AND kind = ?", teamWalletRateID, "settings").First(&setting).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return &meteringExchangeRate{
		ID:            teamWalletRateID,
		Currency:      payment.Currency,
		Rate:          walletSettlementRate,
		Source:        "wallet_settlement",
		EffectiveFrom: setting.UpdatedAt,
	}, nil
}

func (s *GormStore) reserveWalletUsage(ctx context.Context, call CallContext, inputBound, outputBound int64) error {
	rates := legacyMeteringPrice(call.Model, call.StartedAt, false).Rates
	encoded, err := encodeMetering(rates)
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		fx, err := loadWalletSettlementFX(tx)
		if err != nil {
			return err
		}
		if fx == nil {
			return NewHTTPError(503, "wallet_exchange_rate_unavailable", "CNY settlement rate is unavailable")
		}
		if _, err := walletMicros("0", fx.Rate, false); err != nil {
			return err
		}
		now := time.Now().Unix()
		return tx.Create(&walletUsage{RequestID: call.RequestID, UserID: call.walletPayer, Model: call.Model.Name, Rates: encoded, RateID: fx.ID, Rate: fx.Rate, SettlementMode: "postpaid", Status: "reserved", CreatedAt: now, UpdatedAt: now}).Error
	})
}

func (s *GormStore) dispatchWalletUsage(ctx context.Context, call CallContext, route RouteSelection, outputBound int64) error {
	var entry walletUsage
	if err := s.db.WithContext(ctx).Take(&entry, "request_id = ?", call.RequestID).Error; err != nil {
		return err
	}
	if entry.SettlementMode != "postpaid" {
		var upstream ProviderModel
		err := s.db.WithContext(ctx).Select("context_window", "metadata").Take(&upstream, "provider_id = ? AND upstream_model = ?", route.Provider.ID, route.ProviderModel).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		// The published provider window bounds accepted prompt tokens. A route
		// with unknown limits cannot make a reliable reservation.
		if route.Provider.Type != ProviderMock && (upstream.ContextWindow <= 0 || upstream.ContextWindow > call.Model.ContextWindow) {
			return walletUsageError()
		}
		if configured := modelMaxOutputTokens(Model{Metadata: upstream.Metadata}); configured > 0 && outputBound > configured {
			return walletUsageError()
		}
	}
	query := s.db.WithContext(ctx).Model(&walletUsage{}).
		Where("request_id = ? AND status = ?", call.RequestID, "reserved")
	if entry.SettlementMode != "postpaid" {
		query = query.Where("output_bound >= ?", outputBound)
	}
	result := query.
		Updates(map[string]any{"status": "dispatched", "updated_at": time.Now().Unix()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return NewHTTPError(409, "wallet_request_already_dispatched", "The prepaid request cannot be dispatched again")
	}
	return nil
}

func finishWalletUsage(tx *gorm.DB, requestID string, usage Usage, now int64) error {
	var entry walletUsage
	err := tx.Where("request_id = ?", requestID).Take(&entry).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if entry.Status != "reserved" && entry.Status != "dispatched" && entry.Status != "pending_review" {
		return nil
	}
	status, amount := "released", int64(0)
	if entry.Status != "reserved" {
		status, amount = walletUsageCharge(entry, usage)
	}
	if entry.Status == status {
		return nil
	}
	return updateWalletUsage(tx, entry, status, amount, now)
}

func updateWalletUsage(tx *gorm.DB, entry walletUsage, status string, amount, now int64) error {
	result := tx.Model(&walletUsage{}).Where("request_id = ? AND status = ?", entry.RequestID, entry.Status).
		Updates(map[string]any{"status": status, "charged_micros": amount, "updated_at": now})
	if result.Error != nil || result.RowsAffected != 1 {
		return result.Error
	}
	if status == "pending_review" || entry.SettlementMode != "postpaid" && entry.ReservedMicros == 0 {
		return nil
	}
	if amount < 0 {
		return errors.New("invalid wallet charge")
	}
	query := tx.Model(&userWallet{}).
		Where("user_id = ? AND currency = ? AND reserved_usage_micros >= ?", entry.UserID, payment.Currency, entry.ReservedMicros)
	if entry.SettlementMode == "postpaid" {
		query = query.Where("balance_micros >= ?", int64(math.MinInt64)+amount)
	} else {
		query = query.Where("balance_micros >= ?", amount)
	}
	updated := query.
		Updates(map[string]any{
			"balance_micros":        gorm.Expr("balance_micros - ?", amount),
			"balance_fen":           gorm.Expr("(balance_micros - ?) / ?", amount, walletMicrosPerFen),
			"reserved_usage_micros": gorm.Expr("reserved_usage_micros - ?", entry.ReservedMicros),
			"updated_at":            now,
		})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return errors.New("wallet usage reservation missing")
	}
	return nil
}

func (s *GormStore) reconcileWalletUsage(ctx context.Context) error {
	now := time.Now().Unix()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var entries []walletUsage
		if err := tx.Where("status IN ? AND updated_at <= ?", []string{"reserved", "dispatched"}, now-3600).Order("updated_at, request_id").Limit(50).Find(&entries).Error; err != nil {
			return err
		}
		for _, entry := range entries {
			status := "released"
			if entry.Status == "dispatched" {
				status = "pending_review"
			}
			if err := updateWalletUsage(tx, entry, status, 0, now); err != nil {
				return err
			}
		}
		return nil
	})
}
