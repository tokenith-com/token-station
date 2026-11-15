package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tokenhub/backend/internal/payment"
)

const paymentSettingsKind = "payment-checkout-settings"

type rechargeSettings struct {
	Plans         []payment.Plan `json:"plans"`
	CustomEnabled bool           `json:"custom_enabled"`
	MinFen        int64          `json:"min_fen"`
	MaxFen        int64          `json:"max_fen"`
}

func (s *Server) rechargeSettings() (rechargeSettings, error) {
	value := rechargeSettings{Plans: s.payments.config.Plans, MinFen: 100, MaxFen: 5000000}
	var row AdminResource
	err := s.payments.store.db.Where("id = ? AND kind = ?", "checkout", paymentSettingsKind).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	raw, err := json.Marshal(row.Fields)
	if err != nil {
		return value, err
	}
	err = json.Unmarshal(raw, &value)
	return value, err
}
func validateRechargeSettings(v rechargeSettings) error {
	if len(v.Plans) > 100 || v.MinFen < 1 || v.MaxFen < v.MinFen || v.MaxFen > 100000000 {
		return NewHTTPError(400, "invalid_recharge_settings", "Invalid recharge limits")
	}
	seen := map[string]bool{}
	for _, p := range v.Plans {
		if strings.TrimSpace(p.ID) == "" || len(p.ID) > 64 || p.ID == "custom" || seen[p.ID] || strings.TrimSpace(p.Name) == "" || len([]rune(p.Name)) > 40 || p.AmountFen < 1 || p.AmountFen > 100000000 {
			return NewHTTPError(400, "invalid_recharge_settings", "Invalid or duplicate recharge plan")
		}
		seen[p.ID] = true
	}
	return nil
}
func (s *Server) paymentSettings(w http.ResponseWriter, r *http.Request) {
	user, ok := s.paymentUser(w, r, true)
	if !ok {
		return
	}
	if normalizeAdminRole(user.Role) != "system_admin" {
		writeError(w, r, NewHTTPError(403, "payment_forbidden", "System administrator required"))
		return
	}
	if r.Method == http.MethodGet {
		value, err := s.rechargeSettings()
		if err != nil {
			paymentWriteError(w, r, err)
			return
		}
		writeJSON(w, 200, value)
		return
	}
	var value rechargeSettings
	if err := s.decodeJSON(w, r, &value); err != nil {
		writeError(w, r, err)
		return
	}
	if err := validateRechargeSettings(value); err != nil {
		writeError(w, r, err)
		return
	}
	raw, _ := json.Marshal(value)
	fields := map[string]any{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		paymentWriteError(w, r, err)
		return
	}
	row := AdminResource{ID: "checkout", Kind: paymentSettingsKind, Name: "Recharge settings", Status: StatusActive, Fields: fields, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	err := s.payments.store.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}, {Name: "kind"}}, DoUpdates: clause.AssignmentColumns([]string{"fields", "updated_at"})}).Create(&row).Error
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	writeJSON(w, 200, value)
}

func enabledRechargePlans(plans []payment.Plan) []payment.Plan {
	result := make([]payment.Plan, 0, len(plans))
	for _, p := range plans {
		if !p.Disabled {
			result = append(result, p)
		}
	}
	return result
}
