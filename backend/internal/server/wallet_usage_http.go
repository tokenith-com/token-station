package server

import (
	"net/http"
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
	writeJSON(w, 200, map[string]any{"data": rows, "limit": limit, "offset": offset})
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
