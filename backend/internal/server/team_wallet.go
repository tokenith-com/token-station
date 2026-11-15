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

// ConvertUSDToCNYCents rounds positive charges up to the next cent without floats.
func ConvertUSDToCNYCents(usd, rate string) (int64, error) {
	if !walletDecimal.MatchString(usd) || !walletDecimal.MatchString(rate) {
		return 0, NewHTTPError(400, "invalid_wallet_decimal", "Amounts and rates must be decimal strings with at most six fractional digits")
	}
	amount, _ := new(big.Rat).SetString(usd)
	exchange, _ := new(big.Rat).SetString(rate)
	if exchange.Sign() <= 0 {
		return 0, NewHTTPError(400, "invalid_exchange_rate", "Exchange rate must be positive")
	}
	amount.Mul(amount, exchange).Mul(amount, big.NewRat(100, 1))
	cents, remainder := new(big.Int), new(big.Int)
	cents.QuoRem(amount.Num(), amount.Denom(), remainder)
	if remainder.Sign() > 0 {
		cents.Add(cents, big.NewInt(1))
	}
	if !cents.IsInt64() {
		return 0, NewHTTPError(400, "wallet_amount_overflow", "Converted amount exceeds the supported range")
	}
	return cents.Int64(), nil
}

type teamWallet struct {
	TeamID       string    `gorm:"primaryKey" json:"team_id"`
	BalanceCents int64     `json:"balance_cents"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type teamWalletEntry struct {
	ID                 string    `gorm:"primaryKey" json:"id"`
	TeamID             string    `json:"team_id"`
	RequestID          string    `json:"request_id"`
	AmountCents        int64     `json:"amount_cents"`
	ActorUserID        string    `json:"actor_user_id"`
	CreatedAt          time.Time `json:"created_at"`
	CreditType         string    `json:"credit_type"`
	Remark             string    `json:"remark"`
	BeforeBalanceCents *int64    `json:"before_balance_cents"`
	AfterBalanceCents  *int64    `json:"after_balance_cents"`
	ActorName          string    `json:"actor_name"`
	TeamName           string    `json:"team_name"`
}

type teamWalletCall struct {
	RequestID     string     `gorm:"primaryKey" json:"request_id"`
	TeamID        string     `json:"team_id"`
	ReservedCents int64      `json:"reserved_cents"`
	ExchangeRate  string     `json:"exchange_rate"`
	SettledCents  int64      `json:"settled_cents"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	SettledAt     *time.Time `json:"settled_at,omitempty"`
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

type teamWalletStore interface {
	TeamWallet(teamID string) (teamWallet, error)
	CreditTeamWalletWithMetadata(teamID, requestID, actorID string, cents int64, creditType, remark string) (teamWalletEntry, error)
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
	if _, err := ConvertUSDToCNYCents("0", rate); !ok || err != nil {
		return "", NewHTTPError(503, "team_wallet_exchange_rate_unconfigured", "Team wallet exchange rate is not configured")
	}
	return rate, nil
}

func reserveTeamWalletCall(tx *gorm.DB, teamID, requestID, rate string, cents int64, now time.Time) error {
	if strings.TrimSpace(teamID) == "" || strings.TrimSpace(requestID) == "" || cents <= 0 {
		return NewHTTPError(409, "team_wallet_reservation_unavailable", "Team wallet call reservation is unavailable")
	}
	var existing teamWalletCall
	err := tx.First(&existing, "request_id = ?", requestID).Error
	if err == nil {
		if existing.TeamID != teamID || existing.ReservedCents != cents || existing.ExchangeRate != rate {
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
	result := tx.Model(&teamWallet{}).Where("team_id = ? AND balance_cents >= ?", teamID, cents).Updates(map[string]any{"balance_cents": gorm.Expr("balance_cents - ?", cents), "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return NewHTTPError(409, "team_wallet_insufficient_balance", "Team wallet balance is insufficient")
	}
	return tx.Create(&teamWalletCall{RequestID: requestID, TeamID: teamID, ReservedCents: cents, ExchangeRate: rate, Status: teamWalletCallReserved, CreatedAt: now}).Error
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
	if err := tx.Model(&teamWallet{}).Where("team_id = ?", call.TeamID).Updates(map[string]any{"balance_cents": gorm.Expr("balance_cents + ?", call.ReservedCents), "updated_at": now}).Error; err != nil {
		return err
	}
	call.Status = teamWalletCallReleased
	call.SettledAt = &now
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
		settled, err = ConvertUSDToCNYCents(usd, reservation.ExchangeRate)
		if err != nil {
			return errTeamWalletSettlementInvalid
		}
		if settled > reservation.ReservedCents {
			return errTeamWalletSettlementExceeded
		}
	}
	refund := reservation.ReservedCents - settled
	if refund > 0 {
		if err := tx.Model(&teamWallet{}).Where("team_id = ?", reservation.TeamID).Updates(map[string]any{"balance_cents": gorm.Expr("balance_cents + ?", refund), "updated_at": now}).Error; err != nil {
			return err
		}
	}
	reservation.SettledCents = settled
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

func (s *GormStore) CreditTeamWallet(teamID, requestID, actorID string, cents int64) (teamWalletEntry, error) {
	return s.creditTeamWallet(teamID, requestID, actorID, cents, "legacy", "")
}

func (s *GormStore) CreditTeamWalletWithMetadata(teamID, requestID, actorID string, cents int64, creditType, remark string) (teamWalletEntry, error) {
	remark = strings.TrimSpace(remark)
	if (creditType != "offline_receipt" && creditType != "approved_credit") || remark == "" || utf8.RuneCountInString(remark) > 1000 {
		return teamWalletEntry{}, NewHTTPError(400, "invalid_wallet_credit_metadata", "credit_type must be offline_receipt or approved_credit and a remark of at most 1000 characters is required")
	}
	return s.creditTeamWallet(teamID, requestID, actorID, cents, creditType, remark)
}

func (s *GormStore) creditTeamWallet(teamID, requestID, actorID string, cents int64, creditType, remark string) (teamWalletEntry, error) {
	if cents <= 0 || strings.TrimSpace(requestID) == "" || len(requestID) > 128 || strings.TrimSpace(actorID) == "" {
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
			if entry.AmountCents != cents || entry.ActorUserID != actorID || entry.CreditType != creditType || entry.Remark != remark {
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
		result := tx.Model(&teamWallet{}).Where("team_id = ? AND balance_cents <= ?", teamID, math.MaxInt64-cents).Updates(map[string]any{"balance_cents": gorm.Expr("balance_cents + ?", cents), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return NewHTTPError(409, "wallet_balance_overflow", "Wallet balance exceeds the supported range")
		}
		if err := tx.First(&wallet, "team_id = ?", teamID).Error; err != nil {
			return err
		}
		before, after := wallet.BalanceCents-cents, wallet.BalanceCents
		var actor AdminUser
		if err := tx.First(&actor, "id = ?", actorID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		entry = teamWalletEntry{ID: NewID("twl"), TeamID: teamID, RequestID: requestID, AmountCents: cents, ActorUserID: actorID, CreatedAt: now,
			CreditType: creditType, Remark: remark, BeforeBalanceCents: &before, AfterBalanceCents: &after, ActorName: actor.Name, TeamName: team.Name}
		return tx.Create(&entry).Error
	})
	return entry, err
}

func (s *Server) registerTeamWalletRoutes() {
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
			if _, err := ConvertUSDToCNYCents("0", rate); ok && err == nil {
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
	writeJSON(w, 200, map[string]any{"wallet": wallet, "currency": "CNY", "paid_calls_enabled": wallet.BalanceCents > 0 && s.teamWalletRateConfigured()})
}

func (s *Server) handleTeamWalletCredit(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireAdmin(w, r, "team_wallet", http.MethodPost)
	if !ok {
		return
	}
	if !isPlatformAdminRole(user.Role) {
		writeError(w, r, NewHTTPError(403, "wallet_forbidden", "Only platform administrators may credit team wallets"))
		return
	}
	var req struct {
		AmountCents int64  `json:"amount_cents"`
		RequestID   string `json:"request_id"`
		CreditType  string `json:"credit_type"`
		Remark      string `json:"remark"`
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
	if req.AmountCents > 9007199254740991 {
		writeError(w, r, NewHTTPError(400, "invalid_wallet_credit", "amount_cents must not exceed the JavaScript safe integer range"))
		return
	}
	entry, err := store.CreditTeamWalletWithMetadata(r.PathValue("team_id"), req.RequestID, user.ID, req.AmountCents, req.CreditType, req.Remark)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"entry": entry, "currency": "CNY"})
}

func (s *Server) handleTeamWalletRate(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r, "team_wallet", r.Method); !ok {
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
		if _, err := ConvertUSDToCNYCents("0", req.Rate); err != nil {
			writeError(w, r, err)
			return
		}
		store, ok := s.store.(interface {
			CreateResourceChecked(string, AdminResource) (AdminResource, error)
		})
		if !ok {
			writeError(w, r, NewHTTPError(501, "wallet_unavailable", "Team wallet settings are unavailable"))
			return
		}
		if _, err := store.CreateResourceChecked("settings", AdminResource{ID: teamWalletRateID, Name: "Team wallet exchange rate", Status: StatusActive, Fields: map[string]any{"usd_to_cny": req.Rate}}); err != nil {
			writeError(w, r, err)
			return
		}
	}
	rate := ""
	for _, item := range s.store.ListResources("settings") {
		if item.ID == teamWalletRateID && item.Status == StatusActive {
			candidate, ok := item.Fields["usd_to_cny"].(string)
			if _, err := ConvertUSDToCNYCents("0", candidate); ok && err == nil {
				rate = candidate
			}
		}
	}
	writeJSON(w, 200, map[string]any{"usd_to_cny": rate, "configured": rate != "", "paid_calls_enabled": s.teamWalletRateConfigured()})
}
