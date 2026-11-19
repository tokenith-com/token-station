package server

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Server) listOwnWalletUsage(w http.ResponseWriter, r *http.Request) {
	user, ok := s.paymentUser(w, r, false)
	if ok {
		s.listWalletUsage(w, r, user.ID)
	}
}

func (s *Server) listOperatorWalletUsage(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.paymentUser(w, r, true); ok {
		s.listWalletUsage(w, r, "")
	}
}

func (s *Server) listWalletUsage(w http.ResponseWriter, r *http.Request, userID string) {
	w.Header().Set("Cache-Control", "no-store")
	limit, offset := paymentPage(r)
	db := s.payments.store.db.WithContext(r.Context()).Model(&walletUsage{})
	if userID != "" {
		db = db.Where("user_id = ?", userID)
	}
	if requestID := r.URL.Query().Get("request_id"); requestID != "" {
		db = db.Where("request_id = ?", requestID)
	}
	if status := r.URL.Query().Get("status"); status != "" {
		db = db.Where("status = ?", status)
	}
	rows := make([]walletUsage, 0)
	if err := db.Order("created_at DESC, request_id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		paymentWriteError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"data": walletUsageRowsWithTokens(s.payments.store.db.WithContext(r.Context()), rows), "limit": limit, "offset": offset})
}

// walletUsageTokens adds the token counts recorded for the same request so a
// consumer can see what a charge was for. Usage rows are optional: a request
// that never produced usage simply reports zero tokens.
type walletUsageTokens struct {
	RequestID    string `json:"request_id"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	TotalTokens  int64  `json:"total_tokens"`
	CostUSD      string `json:"cost_usd"`
}

type walletUsageRow struct {
	walletUsage
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	TotalTokens  int64  `json:"total_tokens"`
	CostUSD      string `json:"cost_usd"`
}

func walletUsageRowsWithTokens(db *gorm.DB, rows []walletUsage) []walletUsageRow {
	out := make([]walletUsageRow, 0, len(rows))
	if len(rows) == 0 {
		return out
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.RequestID)
	}
	var usage []struct {
		RequestID    string
		InputTokens  int64
		OutputTokens int64
		TotalTokens  int64
		CostUSD      float64
	}
	if err := db.Table("usage_records").
		Select("request_id, input_tokens, output_tokens, total_tokens, cost_usd").
		Where("request_id IN ?", ids).Scan(&usage).Error; err != nil {
		// Token detail is supplementary; a failed lookup still returns charges.
		usage = nil
	}
	byRequest := make(map[string]walletUsageTokens, len(usage))
	for _, item := range usage {
		byRequest[item.RequestID] = walletUsageTokens{
			RequestID: item.RequestID, InputTokens: item.InputTokens, OutputTokens: item.OutputTokens,
			TotalTokens: item.TotalTokens, CostUSD: strconv.FormatFloat(item.CostUSD, 'f', 10, 64),
		}
	}
	for _, row := range rows {
		detail := byRequest[row.RequestID]
		out = append(out, walletUsageRow{
			walletUsage: row, InputTokens: detail.InputTokens, OutputTokens: detail.OutputTokens,
			TotalTokens: detail.TotalTokens, CostUSD: detail.CostUSD,
		})
	}
	return out
}

func (s *Server) resolveOperatorWalletUsage(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.paymentUser(w, r, true)
	if !ok {
		return
	}
	var input struct {
		ChargedMicros *int64 `json:"charged_micros"`
		Reason        string `json:"reason"`
	}
	if err := s.decodeJSON(w, r, &input); err != nil {
		writeError(w, r, err)
		return
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if input.ChargedMicros == nil || *input.ChargedMicros < 0 || input.Reason == "" || len(input.Reason) > 500 {
		writeError(w, r, NewHTTPError(400, "invalid_wallet_resolution", "A nonnegative charge and reconciliation reason are required"))
		return
	}
	amount := *input.ChargedMicros
	var entry walletUsage
	err := s.payments.store.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&entry, "request_id = ?", r.PathValue("request_id")).Error; err != nil {
			return err
		}
		if entry.Status != "pending_review" || (entry.SettlementMode != "postpaid" && amount > entry.ReservedMicros) {
			return NewHTTPError(409, "wallet_resolution_conflict", "The request must be pending review and the charge must fit the reservation")
		}
		status := "settled"
		if amount == 0 {
			status = "released"
		}
		now := time.Now().Unix()
		if err := updateWalletUsage(tx, entry, status, amount, now); err != nil {
			return err
		}
		if err := tx.Take(&entry, "request_id = ?", entry.RequestID).Error; err != nil {
			return err
		}
		if entry.Status != status || entry.ChargedMicros != amount {
			return NewHTTPError(409, "wallet_resolution_conflict", "The request has already been reconciled")
		}
		return nil
	})
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	s.recordAdminAudit(r, actor, "resolve", "wallet_usage", entry.RequestID, nil, map[string]any{"charged_micros": amount, "status": entry.Status, "reason": input.Reason})
	writeJSON(w, 200, entry)
}
