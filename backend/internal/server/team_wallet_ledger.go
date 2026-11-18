package server

import (
	"net/http"
	"strconv"
	"time"

	"gorm.io/gorm"

	"tokenhub/backend/internal/dbschema"
)

func teamWalletLedgerMigration() dbschema.Migration {
	return dbschema.Migration{Version: 20, Name: "add-team-wallet-credit-metadata", ChecksumOverride: "tokenhub-schema-team-wallet-credit-metadata-v1", StatementBudget: 8, Statements: []string{
		`ALTER TABLE team_wallet_entries ADD COLUMN credit_type text NOT NULL DEFAULT 'legacy'`,
		`ALTER TABLE team_wallet_entries ADD COLUMN remark text NOT NULL DEFAULT ''`,
		`ALTER TABLE team_wallet_entries ADD COLUMN before_balance_cents bigint`,
		`ALTER TABLE team_wallet_entries ADD COLUMN after_balance_cents bigint`,
		`ALTER TABLE team_wallet_entries ADD COLUMN actor_name text NOT NULL DEFAULT ''`,
		`ALTER TABLE team_wallet_entries ADD COLUMN team_name text NOT NULL DEFAULT ''`,
		`CREATE INDEX IF NOT EXISTS idx_team_wallet_entries_ledger ON team_wallet_entries (team_id, created_at, id)`,
		`CREATE INDEX IF NOT EXISTS idx_team_wallet_calls_ledger ON team_wallet_calls (team_id, created_at, request_id)`,
	}}
}

type teamWalletLedgerEntry struct {
	ID                  string     `json:"id"`
	TeamID              string     `json:"team_id"`
	RequestID           string     `json:"request_id"`
	AmountMicros        int64      `json:"amount_micros"`
	ActorUserID         string     `json:"actor_user_id"`
	CreatedAt           time.Time  `json:"created_at"`
	CreditType          string     `json:"credit_type"`
	Remark              string     `json:"remark"`
	BeforeBalanceMicros *int64     `json:"before_balance_micros"`
	AfterBalanceMicros  *int64     `json:"after_balance_micros"`
	ActorName           string     `json:"actor_name"`
	TeamName            string     `json:"team_name"`
	Kind                string     `json:"kind"`
	Status              string     `json:"status"`
	ActualAmountMicros  int64      `json:"actual_amount_micros"`
	ReservedMicros      int64      `json:"reserved_micros"`
	SettledMicros       int64      `json:"settled_micros"`
	ExchangeRate        string     `json:"exchange_rate"`
	SettledAt           *time.Time `json:"settled_at"`
}

// Each call is one lifecycle row. amount_micros is its current net wallet
// effect; actual_amount_micros excludes outstanding reservations and is signed
// consumption.
func (s *GormStore) TeamWalletLedger(teamID, requestID string, limit, offset int) ([]teamWalletLedgerEntry, int64, error) {
	query := `SELECT id, team_id, request_id, amount_micros, actor_user_id, created_at,
		credit_type, remark, before_balance_micros, after_balance_micros, actor_name, team_name,
		'credit' AS kind, 'credited' AS status, amount_micros AS actual_amount_micros,
		0 AS reserved_micros, 0 AS settled_micros, '' AS exchange_rate, NULL AS settled_at
		FROM team_wallet_entries WHERE team_id = ?
		UNION ALL
		SELECT calls.request_id AS id, calls.team_id, calls.request_id,
		CASE WHEN calls.status = 'reserved' THEN -calls.reserved_micros ELSE -calls.settled_micros END AS amount_micros,
		COALESCE(NULLIF(calls.actor_user_id, ''), logs.attributed_user_id, '') AS actor_user_id, calls.created_at, '' AS credit_type, '' AS remark,
		CASE WHEN calls.status = 'reserved' THEN calls.reserved_before_balance_micros ELSE calls.finalized_before_balance_micros END AS before_balance_micros,
		CASE WHEN calls.status = 'reserved' THEN calls.reserved_after_balance_micros ELSE calls.finalized_after_balance_micros END AS after_balance_micros,
		COALESCE(NULLIF(calls.actor_name, ''), NULLIF(users.name, ''), users.username, '') AS actor_name, '' AS team_name,
		'call' AS kind, calls.status, -calls.settled_micros AS actual_amount_micros,
		calls.reserved_micros, calls.settled_micros, calls.exchange_rate, calls.settled_at
		FROM team_wallet_calls AS calls
		LEFT JOIN request_logs AS logs ON logs.request_id = calls.request_id
		LEFT JOIN admin_users AS users ON users.id = COALESCE(NULLIF(calls.actor_user_id, ''), logs.attributed_user_id)
		WHERE calls.team_id = ?`
	args := []any{teamID, teamID}
	if requestID != "" {
		query = `SELECT * FROM (` + query + `) AS filtered_ledger WHERE request_id = ?`
		args = append(args, requestID)
	}
	entries := make([]teamWalletLedgerEntry, 0)
	var total int64
	err := s.criticalReadDatabase().Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`SELECT COUNT(*) FROM (`+query+`) AS ledger_count`, args...).Scan(&total).Error; err != nil {
			return err
		}
		pageArgs := append(append([]any{}, args...), limit, offset)
		return tx.Raw(`SELECT * FROM (`+query+`) AS ledger ORDER BY created_at DESC, kind DESC, id DESC LIMIT ? OFFSET ?`, pageArgs...).Scan(&entries).Error
	})
	return entries, total, err
}

func (s *Server) handleTeamWalletLedger(w http.ResponseWriter, r *http.Request) {
	user, ok := s.authorizeAdminUser(w, r)
	if !ok {
		return
	}
	teamID := r.PathValue("team_id")
	if !isPlatformAdminRole(user.Role) && !(normalizeAdminRole(user.Role) == "team_leader" && user.TeamID == teamID && s.activeTeamIDSet()[teamID]) {
		writeError(w, r, NewHTTPError(403, "wallet_forbidden", "Wallet ledger is only available to the team's leader or platform administrators"))
		return
	}
	if _, err := s.findResource("teams", teamID); err != nil {
		writeError(w, r, err)
		return
	}
	limit, offset := 50, 0
	for key, target := range map[string]*int{"limit": &limit, "offset": &offset} {
		if value := r.URL.Query().Get(key); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 0 || (key == "limit" && n == 0) {
				writeError(w, r, NewHTTPError(400, "invalid_pagination", "limit must be positive and offset must be nonnegative integers"))
				return
			}
			*target = n
		}
	}
	if limit > 200 {
		limit = 200
	}
	requestID := r.URL.Query().Get("request_id")
	if len(requestID) > 128 {
		writeError(w, r, NewHTTPError(400, "invalid_request_id", "request_id must be at most 128 bytes"))
		return
	}
	store, ok := s.store.(teamWalletStore)
	if !ok {
		writeError(w, r, NewHTTPError(501, "wallet_unavailable", "Team wallets are unavailable"))
		return
	}
	entries, total, err := store.TeamWalletLedger(teamID, requestID, limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "total": total, "limit": limit, "offset": offset, "currency": "CNY"})
}
