package server

import (
	"net/http"
	"strconv"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tokenhub/backend/internal/dbschema"
)

type teamWalletRateHistoryEntry struct {
	ID          string    `gorm:"primaryKey" json:"id"`
	USDToCNY    string    `json:"usd_to_cny"`
	CreatedAt   time.Time `json:"created_at"`
	ActorUserID string    `json:"actor_user_id"`
	ActorName   string    `json:"actor_name"`
}

func teamWalletRateHistoryMigration() dbschema.Migration {
	return dbschema.Migration{Version: 21, Name: "add-team-wallet-rate-history", ChecksumOverride: "tokenhub-schema-team-wallet-rate-history-v1", StatementBudget: 2, Statements: []string{
		`CREATE TABLE IF NOT EXISTS team_wallet_rate_history_entries (id text PRIMARY KEY, usd_to_cny text NOT NULL, created_at timestamp NOT NULL, actor_user_id text NOT NULL, actor_name text NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_team_wallet_rate_history_order ON team_wallet_rate_history_entries (created_at DESC, id DESC)`,
	}}
}

func reservedTeamWalletRateError() error {
	return NewHTTPError(403, "reserved_team_wallet_rate", "Use the team wallet exchange rate endpoint to save this setting")
}

type teamWalletRateStore interface {
	SaveTeamWalletRate(rate, actorID string) (teamWalletRateHistoryEntry, error)
	TeamWalletRateHistory(limit, offset int) ([]teamWalletRateHistoryEntry, int64, error)
}

func (s *GormStore) SaveTeamWalletRate(rate, actorID string) (teamWalletRateHistoryEntry, error) {
	if _, err := ConvertUSDToCNYMicros("0", rate, false); err != nil {
		return teamWalletRateHistoryEntry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var entry teamWalletRateHistoryEntry
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.lockScopeForUpdate(tx, "team_wallet_rate", teamWalletRateID); err != nil {
			return err
		}
		now := time.Now().UTC()
		var actor AdminUser
		if err := tx.First(&actor, "id = ?", actorID).Error; err != nil {
			return err
		}
		setting := AdminResource{ID: teamWalletRateID, Kind: "settings", Name: "Team wallet exchange rate", Status: StatusActive,
			Fields: map[string]any{"usd_to_cny": rate}, CreatedAt: now, UpdatedAt: now}
		if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&setting).Error; err != nil {
			return err
		}
		entry = teamWalletRateHistoryEntry{ID: NewID("twr"), USDToCNY: rate, CreatedAt: now, ActorUserID: actor.ID, ActorName: actor.Name}
		return tx.Create(&entry).Error
	})
	return entry, err
}

func (s *GormStore) TeamWalletRateHistory(limit, offset int) ([]teamWalletRateHistoryEntry, int64, error) {
	entries := make([]teamWalletRateHistoryEntry, 0)
	var total int64
	err := s.criticalReadDatabase().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&teamWalletRateHistoryEntry{}).Count(&total).Error; err != nil {
			return err
		}
		return tx.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&entries).Error
	})
	return entries, total, err
}

func (s *Server) handleTeamWalletRateHistory(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireAdmin(w, r, "team_wallet", http.MethodGet)
	if !ok {
		return
	}
	if normalizeAdminRole(user.Role) != "admin" {
		writeError(w, r, NewHTTPError(403, "wallet_forbidden", "Only admin may view the wallet exchange rate history"))
		return
	}
	limit, offset := 50, 0
	for key, target := range map[string]*int{"limit": &limit, "offset": &offset} {
		if values, present := r.URL.Query()[key]; present {
			n, err := strconv.Atoi(values[0])
			if len(values) != 1 || err != nil || n < 0 || (key == "limit" && n == 0) {
				writeError(w, r, NewHTTPError(400, "invalid_pagination", "limit must be positive and offset must be nonnegative integers"))
				return
			}
			*target = n
		}
	}
	if limit > 200 {
		limit = 200
	}
	store, ok := s.store.(teamWalletRateStore)
	if !ok {
		writeError(w, r, NewHTTPError(501, "wallet_unavailable", "Team wallet settings are unavailable"))
		return
	}
	entries, total, err := store.TeamWalletRateHistory(limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "total": total, "limit": limit, "offset": offset})
}
