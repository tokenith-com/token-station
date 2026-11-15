package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CustomerOnboardingRequest struct {
	CostCenterCode string `json:"cost_center_code"`
	CostCenterName string `json:"cost_center_name"`
	TeamName       string `json:"team_name"`
	ProjectName    string `json:"project_name"`
	LeaderUsername string `json:"leader_username"`
	LeaderEmail    string `json:"leader_email"`
	LeaderPassword string `json:"leader_password"`
	IdempotencyKey string `json:"idempotency_key"`
}

type CustomerOnboardingResult struct {
	CostCenter    AdminResource `json:"cost_center"`
	Team          AdminResource `json:"team"`
	Leader        AdminUser     `json:"leader"`
	Project       Project       `json:"project"`
	ProjectMember AdminResource `json:"project_member"`
}

func onboardingDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (s *GormStore) CreateCustomerOnboarding(ctx context.Context, req CustomerOnboardingRequest) (CustomerOnboardingResult, bool, error) {
	for _, value := range []*string{&req.CostCenterCode, &req.CostCenterName, &req.TeamName, &req.ProjectName, &req.LeaderUsername, &req.LeaderEmail, &req.IdempotencyKey} {
		*value = strings.TrimSpace(*value)
		if *value == "" || len(*value) > 255 {
			return CustomerOnboardingResult{}, false, NewHTTPError(400, "invalid_customer_onboarding", "All onboarding fields are required and must not exceed 255 bytes")
		}
	}
	address, err := mail.ParseAddress(req.LeaderEmail)
	if err != nil || address.Address != req.LeaderEmail || strings.TrimSpace(req.LeaderPassword) == "" {
		return CustomerOnboardingResult{}, false, NewHTTPError(400, "invalid_customer_onboarding", "A valid leader email and password are required")
	}
	// The fingerprint deliberately excludes credentials; retries never change a password.
	fingerprintRequest := req
	fingerprintRequest.LeaderPassword = ""
	fingerprintJSON, err := json.Marshal(fingerprintRequest)
	if err != nil {
		return CustomerOnboardingResult{}, false, err
	}
	fingerprint := onboardingDigest(string(fingerprintJSON))
	s.mu.Lock()
	defer s.mu.Unlock()
	var result CustomerOnboardingResult
	replayed := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		receipt := AdminResource{ID: "onb_" + onboardingDigest(req.IdempotencyKey), Kind: "customer-onboarding", Status: StatusActive, Fields: map[string]any{"fingerprint": fingerprint}, CreatedAt: now, UpdatedAt: now}
		inserted := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&receipt)
		if inserted.Error != nil {
			return inserted.Error
		}
		if inserted.RowsAffected == 0 {
			if err := tx.First(&receipt, "id = ? AND kind = ?", receipt.ID, receipt.Kind).Error; err != nil {
				return err
			}
			if stringField(receipt.Fields, "fingerprint") != fingerprint {
				return NewHTTPError(409, "onboarding_idempotency_conflict", "Idempotency key was already used for a different request")
			}
			if err := json.Unmarshal([]byte(stringField(receipt.Fields, "result")), &result); err != nil {
				return err
			}
			replayed = true
			return nil
		}
		var centers []AdminResource
		if err := tx.Where("kind = ?", "cost-centers").Find(&centers).Error; err != nil {
			return err
		}
		for _, center := range centers {
			if strings.TrimSpace(stringField(center.Fields, "code")) == req.CostCenterCode {
				return NewHTTPError(409, "cost_center_conflict", "Cost center code already exists")
			}
		}
		scoped := &GormStore{db: tx}
		var err error
		result.CostCenter, err = scoped.createResourceLocked("cost-centers", AdminResource{ID: "cc_onb_" + onboardingDigest(req.CostCenterCode), Name: req.CostCenterName, Fields: map[string]any{"code": req.CostCenterCode}}, false)
		if err != nil {
			return writeConflict(err, "cost_center_conflict", "Cost center code already exists")
		}
		result.Team, err = scoped.createResourceLocked("teams", AdminResource{Name: req.TeamName, Fields: map[string]any{"cost_center": req.CostCenterCode}}, false)
		if err != nil {
			return err
		}
		result.Leader, err = createAdminUser(tx, AdminUser{Username: req.LeaderUsername, Email: req.LeaderEmail, Role: "team_leader", TeamID: result.Team.ID, TeamIDs: []string{result.Team.ID}}, req.LeaderPassword)
		if err != nil {
			return err
		}
		result.Project, err = scoped.createProject(Project{Name: req.ProjectName, TeamID: result.Team.ID, OwnerUserID: result.Leader.ID, CostCenter: req.CostCenterCode}, true)
		if err != nil {
			return err
		}
		result.ProjectMember, err = scoped.createResourceLocked("project-members", AdminResource{Name: req.ProjectName + " / " + req.LeaderUsername, Fields: map[string]any{"project_id": result.Project.ID, "user_id": result.Leader.ID, "role": "owner", "can_issue_keys": true, "provisioned_by": "customer_onboarding"}}, false)
		if err != nil {
			return err
		}
		result.CostCenter.Fields["owner"] = result.Leader.ID
		if err := tx.Save(&result.CostCenter).Error; err != nil {
			return err
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			return err
		}
		receipt.Fields["result"] = string(encoded)
		return tx.Save(&receipt).Error
	})
	if err != nil {
		return CustomerOnboardingResult{}, false, err
	}
	return result, replayed, nil
}

func (s *Server) handleCustomerOnboarding(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireAdmin(w, r, "customer_onboarding", r.Method)
	if !ok {
		return
	}
	if !isPlatformAdminRole(actor.Role) {
		writeError(w, r, NewHTTPError(403, "admin_forbidden", "Only platform admins can onboard customers"))
		return
	}
	var req CustomerOnboardingRequest
	if err := s.decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	store, ok := s.store.(interface {
		CreateCustomerOnboarding(context.Context, CustomerOnboardingRequest) (CustomerOnboardingResult, bool, error)
	})
	if !ok {
		writeError(w, r, NewHTTPError(503, "onboarding_unavailable", "Customer onboarding is unavailable"))
		return
	}
	result, replayed, err := store.CreateCustomerOnboarding(r.Context(), req)
	if err != nil {
		writeError(w, r, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	} else {
		s.recordAdminAudit(r, actor, "create", "customer_onboarding", result.Project.ID, "", map[string]any{"cost_center_id": result.CostCenter.ID, "team_id": result.Team.ID, "leader_id": result.Leader.ID, "project_id": result.Project.ID})
	}
	writeJSON(w, status, result)
}
