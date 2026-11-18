package server

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tokenhub/backend/internal/dbschema"
)

const teamWalletRateID = "team-wallet-exchange-rate"

var walletDecimal = regexp.MustCompile(`^[0-9]{1,18}(\.[0-9]{1,6})?$`)

var (
	errTeamWalletSettlementExceeded = NewHTTPError(409, "team_wallet_reservation_exceeded", "Actual team wallet charge exceeds the reserved amount")
	errTeamWalletSettlementInvalid  = NewHTTPError(409, "team_wallet_settlement_invalid", "Team wallet charge cannot be converted using the reserved exchange rate")
)

// ConvertUSDToCNYMicros converts a USD amount into CNY micros (1 CNY = 1,000,000
// micros) without floats. roundUp rounds any remainder away from zero, which
// reservations use so a frozen amount is always a safe upper bound; settlement
// passes false to apply banker's rounding like the consumer wallet.
func ConvertUSDToCNYMicros(usd, rate string, roundUp bool) (int64, error) {
	if !walletDecimal.MatchString(usd) || !walletDecimal.MatchString(rate) {
		return 0, NewHTTPError(400, "invalid_wallet_decimal", "Amounts and rates must be decimal strings with at most six fractional digits")
	}
	amount, _ := new(big.Rat).SetString(usd)
	exchange, _ := new(big.Rat).SetString(rate)
	if exchange.Sign() <= 0 {
		return 0, NewHTTPError(400, "invalid_exchange_rate", "Exchange rate must be positive")
	}
	amount.Mul(amount, exchange).Mul(amount, big.NewRat(1_000_000, 1))
	micros, remainder := new(big.Int), new(big.Int)
	micros.QuoRem(amount.Num(), amount.Denom(), remainder)
	twice := new(big.Int).Lsh(remainder, 1)
	comparison := twice.Cmp(amount.Denom())
	if (roundUp && remainder.Sign() > 0) || (!roundUp && (comparison > 0 || comparison == 0 && micros.Bit(0) == 1)) {
		micros.Add(micros, big.NewInt(1))
	}
	if !micros.IsInt64() {
		return 0, NewHTTPError(400, "wallet_amount_overflow", "Converted amount exceeds the supported range")
	}
	return micros.Int64(), nil
}

type teamWallet struct {
	TeamID        string    `gorm:"primaryKey" json:"team_id"`
	BalanceMicros int64     `json:"balance_micros"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type teamWalletEntry struct {
	ID                  string    `gorm:"primaryKey" json:"id"`
	TeamID              string    `json:"team_id"`
	RequestID           string    `json:"request_id"`
	AmountMicros        int64     `json:"amount_micros"`
	ActorUserID         string    `json:"actor_user_id"`
	CreatedAt           time.Time `json:"created_at"`
	CreditType          string    `json:"credit_type"`
	Remark              string    `json:"remark"`
	BeforeBalanceMicros *int64    `json:"before_balance_micros"`
	AfterBalanceMicros  *int64    `json:"after_balance_micros"`
	ActorName           string    `json:"actor_name"`
	TeamName            string    `json:"team_name"`
}

type teamWalletCall struct {
	RequestID                    string     `gorm:"primaryKey" json:"request_id"`
	TeamID                       string     `json:"team_id"`
	ReservedMicros               int64      `json:"reserved_micros"`
	ExchangeRate                 string     `json:"exchange_rate"`
	SettledMicros                int64      `json:"settled_micros"`
	Status                       string     `json:"status"`
	CreatedAt                    time.Time  `json:"created_at"`
	SettledAt                    *time.Time `json:"settled_at,omitempty"`
	ReservedBeforeBalanceMicros  *int64     `json:"reserved_before_balance_micros"`
	ReservedAfterBalanceMicros   *int64     `json:"reserved_after_balance_micros"`
	FinalizedBeforeBalanceMicros *int64     `json:"finalized_before_balance_micros"`
	FinalizedAfterBalanceMicros  *int64     `json:"finalized_after_balance_micros"`
	ActorUserID                  string     `json:"actor_user_id"`
	ActorName                    string     `json:"actor_name"`
	APIKeyID                     string     `json:"api_key_id"`
}

const (
	teamWalletCallReserved = "reserved"
	teamWalletCallSettled  = "settled"
	teamWalletCallReleased = "released"
	teamWalletCallFailed   = "settlement_failed"
)

func teamWalletMigration() dbschema.Migration {
	return dbschema.Migration{Version: 18, Name: "add-team-wallets", ChecksumOverride: "tokenhub-schema-team-wallets-v1", StatementBudget: 4, Statements: []string{
		`CREATE TABLE IF NOT EXISTS team_wallets (team_id text PRIMARY KEY, balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0), updated_at timestamp NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS team_wallet_entries (id text PRIMARY KEY, team_id text NOT NULL, request_id text NOT NULL, amount_cents bigint NOT NULL CHECK (amount_cents > 0), actor_user_id text NOT NULL, created_at timestamp NOT NULL, UNIQUE (team_id, request_id))`,
		`CREATE TABLE IF NOT EXISTS team_wallet_calls (request_id text PRIMARY KEY, team_id text NOT NULL, reserved_cents bigint NOT NULL CHECK (reserved_cents > 0), settled_cents bigint NOT NULL DEFAULT 0 CHECK (settled_cents >= 0), status text NOT NULL, created_at timestamp NOT NULL, settled_at timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_team_wallet_entries_team_id ON team_wallet_entries (team_id)`,
	}}
}

func teamWalletCallSnapshotMigration() dbschema.Migration {
	return dbschema.Migration{Version: 24, Name: "add-team-wallet-call-snapshots", ChecksumOverride: "tokenhub-schema-team-wallet-call-snapshots-v1", StatementBudget: 7, Statements: []string{
		`ALTER TABLE team_wallet_calls ADD COLUMN reserved_before_balance_cents bigint`,
		`ALTER TABLE team_wallet_calls ADD COLUMN reserved_after_balance_cents bigint`,
		`ALTER TABLE team_wallet_calls ADD COLUMN finalized_before_balance_cents bigint`,
		`ALTER TABLE team_wallet_calls ADD COLUMN finalized_after_balance_cents bigint`,
		`ALTER TABLE team_wallet_calls ADD COLUMN actor_user_id text NOT NULL DEFAULT ''`,
		`ALTER TABLE team_wallet_calls ADD COLUMN actor_name text NOT NULL DEFAULT ''`,
		`ALTER TABLE team_wallet_calls ADD COLUMN api_key_id text NOT NULL DEFAULT ''`,
	}}
}

// teamWalletMicrosMigration unifies the team ledger on CNY micros, the same
// precision the consumer wallet uses: one cent is 10,000 micros. The frozen
// team wallet migrations created cent columns, so this renames them and
// rescales stored values in place.
func teamWalletMicrosMigration() dbschema.Migration {
	return dbschema.Migration{Version: 25, Name: "add-team-wallet-micros", ChecksumOverride: "tokenhub-schema-team-wallet-micros-v1", StatementBudget: 24, Statements: []string{
		`ALTER TABLE team_wallets RENAME COLUMN balance_cents TO balance_micros`,
		`UPDATE team_wallets SET balance_micros = balance_micros * 10000`,
		`ALTER TABLE team_wallet_entries RENAME COLUMN amount_cents TO amount_micros`,
		`UPDATE team_wallet_entries SET amount_micros = amount_micros * 10000`,
		`ALTER TABLE team_wallet_entries RENAME COLUMN before_balance_cents TO before_balance_micros`,
		`UPDATE team_wallet_entries SET before_balance_micros = before_balance_micros * 10000 WHERE before_balance_micros IS NOT NULL`,
		`ALTER TABLE team_wallet_entries RENAME COLUMN after_balance_cents TO after_balance_micros`,
		`UPDATE team_wallet_entries SET after_balance_micros = after_balance_micros * 10000 WHERE after_balance_micros IS NOT NULL`,
		`ALTER TABLE team_wallet_calls RENAME COLUMN reserved_cents TO reserved_micros`,
		`UPDATE team_wallet_calls SET reserved_micros = reserved_micros * 10000`,
		`ALTER TABLE team_wallet_calls RENAME COLUMN settled_cents TO settled_micros`,
		`UPDATE team_wallet_calls SET settled_micros = settled_micros * 10000`,
		`ALTER TABLE team_wallet_calls RENAME COLUMN reserved_before_balance_cents TO reserved_before_balance_micros`,
		`UPDATE team_wallet_calls SET reserved_before_balance_micros = reserved_before_balance_micros * 10000 WHERE reserved_before_balance_micros IS NOT NULL`,
		`ALTER TABLE team_wallet_calls RENAME COLUMN reserved_after_balance_cents TO reserved_after_balance_micros`,
		`UPDATE team_wallet_calls SET reserved_after_balance_micros = reserved_after_balance_micros * 10000 WHERE reserved_after_balance_micros IS NOT NULL`,
		`ALTER TABLE team_wallet_calls RENAME COLUMN finalized_before_balance_cents TO finalized_before_balance_micros`,
		`UPDATE team_wallet_calls SET finalized_before_balance_micros = finalized_before_balance_micros * 10000 WHERE finalized_before_balance_micros IS NOT NULL`,
		`ALTER TABLE team_wallet_calls RENAME COLUMN finalized_after_balance_cents TO finalized_after_balance_micros`,
		`UPDATE team_wallet_calls SET finalized_after_balance_micros = finalized_after_balance_micros * 10000 WHERE finalized_after_balance_micros IS NOT NULL`,
	}}
}

type teamWalletStore interface {
	TeamWallet(teamID string) (teamWallet, error)
	CreditTeamWalletWithMetadata(teamID, requestID, actorID string, micros int64, creditType, remark string) (teamWalletEntry, error)
	TeamWalletLedger(teamID, requestID string, limit, offset int) ([]teamWalletLedgerEntry, int64, error)
}

func teamWalletRate(tx *gorm.DB) (string, error) {
	var setting AdminResource
	if err := tx.Where("id = ? AND kind = ? AND status = ?", teamWalletRateID, "settings", StatusActive).First(&setting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", NewHTTPError(503, "team_wallet_exchange_rate_unconfigured", "Team wallet exchange rate is not configured")
		}
		return "", err
	}
	rate, ok := setting.Fields["usd_to_cny"].(string)
	if _, err := ConvertUSDToCNYMicros("0", rate, false); !ok || err != nil {
		return "", NewHTTPError(503, "team_wallet_exchange_rate_unconfigured", "Team wallet exchange rate is not configured")
	}
	return rate, nil
}

func reserveTeamWalletCall(tx *gorm.DB, teamID, requestID, rate string, micros int64, now time.Time, identity ...string) error {
	apiKeyID, actorUserID := "", ""
	if len(identity) > 0 {
		apiKeyID = identity[0]
	}
	if len(identity) > 1 {
		actorUserID = identity[1]
	}
	if strings.TrimSpace(teamID) == "" || strings.TrimSpace(requestID) == "" || micros <= 0 {
		return NewHTTPError(409, "team_wallet_reservation_unavailable", "Team wallet call reservation is unavailable")
	}
	var existing teamWalletCall
	err := tx.First(&existing, "request_id = ?", requestID).Error
	if err == nil {
		if existing.TeamID != teamID || existing.ReservedMicros != micros || existing.ExchangeRate != rate {
			return NewHTTPError(409, "team_wallet_reservation_conflict", "request_id was already used with different wallet reservation details")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	wallet := teamWallet{TeamID: teamID, UpdatedAt: now}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&wallet).Error; err != nil {
		return err
	}
	var beforeBalance teamWallet
	if err := tx.First(&beforeBalance, "team_id = ?", teamID).Error; err != nil {
		return err
	}
	result := tx.Model(&teamWallet{}).Where("team_id = ? AND balance_micros >= ?", teamID, micros).Updates(map[string]any{"balance_micros": gorm.Expr("balance_micros - ?", micros), "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return NewHTTPError(409, "team_wallet_insufficient_balance", "Team wallet balance is insufficient")
	}
	afterBalance := beforeBalance.BalanceMicros - micros
	return tx.Create(&teamWalletCall{
		RequestID: requestID, TeamID: teamID, ReservedMicros: micros, ExchangeRate: rate,
		Status: teamWalletCallReserved, CreatedAt: now,
		ReservedBeforeBalanceMicros: &beforeBalance.BalanceMicros, ReservedAfterBalanceMicros: &afterBalance,
		ActorUserID: actorUserID, APIKeyID: apiKeyID,
	}).Error
}

func releaseTeamWalletCall(tx *gorm.DB, requestID string, now time.Time) error {
	var call teamWalletCall
	if err := tx.First(&call, "request_id = ?", requestID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if call.Status != teamWalletCallReserved {
		return nil
	}
	var wallet teamWallet
	if err := tx.First(&wallet, "team_id = ?", call.TeamID).Error; err != nil {
		return err
	}
	beforeBalance := wallet.BalanceMicros
	if err := tx.Model(&teamWallet{}).Where("team_id = ?", call.TeamID).Updates(map[string]any{"balance_micros": gorm.Expr("balance_micros + ?", call.ReservedMicros), "updated_at": now}).Error; err != nil {
		return err
	}
	afterBalance := beforeBalance + call.ReservedMicros
	call.Status = teamWalletCallReleased
	call.SettledAt = &now
	call.FinalizedBeforeBalanceMicros = &beforeBalance
	call.FinalizedAfterBalanceMicros = &afterBalance
	return tx.Save(&call).Error
}

func settleTeamWalletCall(tx *gorm.DB, call CallContext, usage Usage, success bool, now time.Time) error {
	if !call.TeamWalletEnabled {
		return nil
	}
	var reservation teamWalletCall
	if err := tx.First(&reservation, "request_id = ?", call.RequestID).Error; err != nil {
		return err
	}
	if reservation.Status == teamWalletCallFailed {
		return errTeamWalletSettlementInvalid
	}
	if reservation.Status != teamWalletCallReserved {
		return nil
	}
	settled := int64(0)
	if success {
		usd := fmt.Sprintf("%.6f", math.Max(usage.CostUSD, 0))
		var err error
		settled, err = ConvertUSDToCNYMicros(usd, reservation.ExchangeRate, false)
		if err != nil {
			return errTeamWalletSettlementInvalid
		}
		if settled > reservation.ReservedMicros {
			return errTeamWalletSettlementExceeded
		}
	}
	refund := reservation.ReservedMicros - settled
	var finalizedBefore int64
	var finalizedAfter int64
	if refund > 0 {
		var wallet teamWallet
		if err := tx.First(&wallet, "team_id = ?", reservation.TeamID).Error; err != nil {
			return err
		}
		finalizedBefore = wallet.BalanceMicros
		if err := tx.Model(&teamWallet{}).Where("team_id = ?", reservation.TeamID).Updates(map[string]any{"balance_micros": gorm.Expr("balance_micros + ?", refund), "updated_at": now}).Error; err != nil {
			return err
		}
		finalizedAfter = finalizedBefore + refund
	} else {
		var wallet teamWallet
		if err := tx.First(&wallet, "team_id = ?", reservation.TeamID).Error; err != nil {
			return err
		}
		finalizedBefore, finalizedAfter = wallet.BalanceMicros, wallet.BalanceMicros
	}
	reservation.SettledMicros = settled
	reservation.FinalizedBeforeBalanceMicros = &finalizedBefore
	reservation.FinalizedAfterBalanceMicros = &finalizedAfter
	reservation.Status = teamWalletCallSettled
	if !success {
		reservation.Status = teamWalletCallReleased
	}
	reservation.SettledAt = &now
	return tx.Save(&reservation).Error
}

func (s *GormStore) failTeamWalletSettlement(call CallContext, route RouteSelection, errorCode, clientIP, userAgent string, now time.Time, elapsed time.Duration) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.lockScopeForUpdate(tx, "request_settlement", call.RequestID); err != nil {
			return err
		}
		var existing int64
		if err := tx.Model(&RequestLog{}).Where("request_id = ?", call.RequestID).Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			return nil
		}
		if err := releaseTeamWalletCall(tx, call.RequestID, now); err != nil {
			return err
		}
		if err := tx.Model(&teamWalletCall{}).Where("request_id = ? AND status = ?", call.RequestID, teamWalletCallReleased).Update("status", teamWalletCallFailed).Error; err != nil {
			return err
		}
		return tx.Create(&RequestLog{
			ID: NewID("log"), RequestID: call.RequestID,
			ProjectID: call.Project.ID, APIKeyID: call.Key.ID,
			AttributedUserID: call.AttributedUserID, ModelName: call.Model.Name,
			ProviderID: route.Provider.ID, ProviderResourceID: routeResourceID(route), ProviderModel: route.ProviderModel,
			StatusCode: http.StatusConflict, ErrorCode: errorCode,
			LatencyMS: elapsed.Milliseconds(), ClientIP: clientIP, UserAgent: userAgent, CreatedAt: now,
		}).Error
	})
}

func (s *GormStore) TeamWallet(teamID string) (teamWallet, error) {
	wallet := teamWallet{TeamID: teamID}
	err := s.criticalReadDatabase().First(&wallet, "team_id = ?", teamID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return wallet, nil
	}
	return wallet, err
}

func (s *GormStore) CreditTeamWallet(teamID, requestID, actorID string, micros int64) (teamWalletEntry, error) {
	return s.creditTeamWallet(teamID, requestID, actorID, micros, "legacy", "")
}

func (s *GormStore) CreditTeamWalletWithMetadata(teamID, requestID, actorID string, micros int64, creditType, remark string) (teamWalletEntry, error) {
	remark = strings.TrimSpace(remark)
	if (creditType != "offline_receipt" && creditType != "approved_credit") || remark == "" || utf8.RuneCountInString(remark) > 1000 {
		return teamWalletEntry{}, NewHTTPError(400, "invalid_wallet_credit_metadata", "credit_type must be offline_receipt or approved_credit and a remark of at most 1000 characters is required")
	}
	return s.creditTeamWallet(teamID, requestID, actorID, micros, creditType, remark)
}

func (s *GormStore) creditTeamWallet(teamID, requestID, actorID string, micros int64, creditType, remark string) (teamWalletEntry, error) {
	if micros <= 0 || strings.TrimSpace(requestID) == "" || len(requestID) > 128 || strings.TrimSpace(actorID) == "" {
		return teamWalletEntry{}, NewHTTPError(400, "invalid_wallet_credit", "A positive amount, actor and request_id of at most 128 bytes are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var entry teamWalletEntry
	err := s.db.Transaction(func(tx *gorm.DB) error {
		team, err := lockAdminResourceForMutation(tx, "teams", teamID)
		if err != nil {
			return err
		}
		if team.Status != "" && team.Status != StatusActive {
			return NewHTTPError(409, "team_inactive", "Team must be active")
		}
		err = tx.First(&entry, "team_id = ? AND request_id = ?", teamID, requestID).Error
		if err == nil {
			if entry.AmountMicros != micros || entry.ActorUserID != actorID || entry.CreditType != creditType || entry.Remark != remark {
				return NewHTTPError(409, "wallet_credit_conflict", "request_id was already used with different credit details")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := time.Now().UTC()
		wallet := teamWallet{TeamID: teamID, UpdatedAt: now}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&wallet).Error; err != nil {
			return err
		}
		result := tx.Model(&teamWallet{}).Where("team_id = ? AND balance_micros <= ?", teamID, math.MaxInt64-micros).Updates(map[string]any{"balance_micros": gorm.Expr("balance_micros + ?", micros), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return NewHTTPError(409, "wallet_balance_overflow", "Wallet balance exceeds the supported range")
		}
		if err := tx.First(&wallet, "team_id = ?", teamID).Error; err != nil {
			return err
		}
		before, after := wallet.BalanceMicros-micros, wallet.BalanceMicros
		var actor AdminUser
		if err := tx.First(&actor, "id = ?", actorID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		entry = teamWalletEntry{ID: NewID("twl"), TeamID: teamID, RequestID: requestID, AmountMicros: micros, ActorUserID: actorID, CreatedAt: now,
			CreditType: creditType, Remark: remark, BeforeBalanceMicros: &before, AfterBalanceMicros: &after, ActorName: actor.Name, TeamName: team.Name}
		return tx.Create(&entry).Error
	})
	return entry, err
}

func (s *Server) registerTeamWalletRoutes() {
	s.registerSingleMethodRoute(http.MethodGet, "/api/admin/team-wallet/exchange-rate/history", s.handleTeamWalletRateHistory, jsonMethodNotAllowed(http.MethodGet))
	s.registerSingleMethodRoute(http.MethodGet, "/api/admin/teams/{team_id}/wallet", s.handleTeamWallet, jsonMethodNotAllowed(http.MethodGet))
	s.registerSingleMethodRoute(http.MethodGet, "/api/admin/teams/{team_id}/wallet/ledger", s.handleTeamWalletLedger, jsonMethodNotAllowed(http.MethodGet))
	s.registerSingleMethodRoute(http.MethodPost, "/api/admin/teams/{team_id}/wallet/credits", s.handleTeamWalletCredit, jsonMethodNotAllowed(http.MethodPost))
	s.registerMethodRoutes("/api/admin/team-wallet/exchange-rate", func(methods string) http.HandlerFunc { return jsonMethodNotAllowed(methods) },
		methodRoute{Method: http.MethodGet, Handler: s.handleTeamWalletRate},
		methodRoute{Method: http.MethodPut, Handler: s.handleTeamWalletRate})
}

func (s *Server) teamWalletRateConfigured() bool {
	for _, item := range s.store.ListResources("settings") {
		if item.ID == teamWalletRateID && item.Status == StatusActive {
			rate, ok := item.Fields["usd_to_cny"].(string)
			if _, err := ConvertUSDToCNYMicros("0", rate, false); ok && err == nil {
				return true
			}
		}
	}
	return false
}

func (s *Server) handleTeamWallet(w http.ResponseWriter, r *http.Request) {
	user, ok := s.authorizeAdminUser(w, r)
	if !ok {
		return
	}
	teamID := r.PathValue("team_id")
	if !isPlatformAdminRole(user.Role) && !(normalizeAdminRole(user.Role) == "team_leader" && user.TeamID == teamID && s.activeTeamIDSet()[teamID]) {
		writeError(w, r, NewHTTPError(403, "wallet_forbidden", "Wallet is only available to the team's leader or platform administrators"))
		return
	}
	if _, err := s.findResource("teams", teamID); err != nil {
		writeError(w, r, err)
		return
	}
	store, ok := s.store.(teamWalletStore)
	if !ok {
		writeError(w, r, NewHTTPError(501, "wallet_unavailable", "Team wallets are unavailable"))
		return
	}
	wallet, err := store.TeamWallet(teamID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"wallet": wallet, "currency": "CNY", "paid_calls_enabled": wallet.BalanceMicros > 0 && s.teamWalletRateConfigured()})
}

func (s *Server) handleTeamWalletCredit(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireAdmin(w, r, "team_wallet", http.MethodPost)
	if !ok {
		return
	}
	if normalizeAdminRole(user.Role) != "admin" {
		writeError(w, r, NewHTTPError(403, "wallet_forbidden", "Only admin may credit team wallets"))
		return
	}
	var req struct {
		AmountMicros int64  `json:"amount_micros"`
		RequestID    string `json:"request_id"`
		CreditType   string `json:"credit_type"`
		Remark       string `json:"remark"`
	}
	if err := s.decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	store, ok := s.store.(teamWalletStore)
	if !ok {
		writeError(w, r, NewHTTPError(501, "wallet_unavailable", "Team wallets are unavailable"))
		return
	}
	if req.AmountMicros > 9007199254740991 {
		writeError(w, r, NewHTTPError(400, "invalid_wallet_credit", "amount_micros must not exceed the JavaScript safe integer range"))
		return
	}
	entry, err := store.CreditTeamWalletWithMetadata(r.PathValue("team_id"), req.RequestID, user.ID, req.AmountMicros, req.CreditType, req.Remark)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"entry": entry, "currency": "CNY"})
}

func (s *Server) handleTeamWalletRate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireAdmin(w, r, "team_wallet", r.Method)
	if !ok {
		return
	}
	if normalizeAdminRole(user.Role) != "admin" {
		writeError(w, r, NewHTTPError(403, "wallet_forbidden", "Only admin may manage the wallet exchange rate"))
		return
	}
	if r.Method == http.MethodPut {
		var req struct {
			Rate string `json:"usd_to_cny"`
		}
		if err := s.decodeJSON(w, r, &req); err != nil {
			writeError(w, r, err)
			return
		}
		if _, err := ConvertUSDToCNYMicros("0", req.Rate, false); err != nil {
			writeError(w, r, err)
			return
		}
		store, ok := s.store.(teamWalletRateStore)
		if !ok {
			writeError(w, r, NewHTTPError(501, "wallet_unavailable", "Team wallet settings are unavailable"))
			return
		}
		entry, err := store.SaveTeamWalletRate(req.Rate, user.ID)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"usd_to_cny": entry.USDToCNY, "configured": true, "paid_calls_enabled": true})
		return
	}
	rate := ""
	for _, item := range s.store.ListResources("settings") {
		if item.ID == teamWalletRateID && item.Status == StatusActive {
			candidate, ok := item.Fields["usd_to_cny"].(string)
			if _, err := ConvertUSDToCNYMicros("0", candidate, false); ok && err == nil {
				rate = candidate
			}
		}
	}
	writeJSON(w, 200, map[string]any{"usd_to_cny": rate, "configured": rate != "", "paid_calls_enabled": s.teamWalletRateConfigured()})
}
