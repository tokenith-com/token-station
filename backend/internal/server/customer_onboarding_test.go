package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"gorm.io/gorm"
)

func onboardingRequest() CustomerOnboardingRequest {
	return CustomerOnboardingRequest{CostCenterCode: "CC-ACME", CostCenterName: "Acme Center", TeamName: "Acme Team", ProjectName: "Acme Project", LeaderUsername: "acme-leader", LeaderEmail: "leader@acme.test", LeaderPassword: "onboarding-password", IdempotencyKey: "acme-onboarding-1"}
}

func TestCustomerOnboardingHTTP(t *testing.T) {
	for _, role := range []string{"admin", "team_leader", "security_admin", "user", "guest"} {
		t.Run(role, func(t *testing.T) {
			store := NewMemoryStore()
			actor, err := store.CreateAdminUser(AdminUser{Username: "actor", Email: "actor@example.test", Role: role}, "actor-password")
			if err != nil {
				t.Fatal(err)
			}
			app := New(store).Handler()
			token := loginAsTeamMemberActor(t, app, actor.Email, "actor-password")
			req := onboardingRequest()
			response := doJSON(t, app, http.MethodPost, "/api/admin/customer-onboarding", req, token)
			if !isPlatformAdminRole(role) {
				if response.Code != http.StatusForbidden {
					t.Fatalf("expected 403, got %d", response.Code)
				}
				if len(store.ListResources("teams")) != 0 {
					t.Fatal("forbidden request created a team")
				}
				return
			}
			if response.Code != http.StatusCreated {
				t.Fatalf("expected 201, got %d: %s", response.Code, response.Body)
			}
			var result CustomerOnboardingResult
			if err := json.Unmarshal([]byte(response.Body), &result); err != nil {
				t.Fatal(err)
			}
			if result.Leader.Role != "team_leader" || result.Leader.TeamID != result.Team.ID || !userHasTeam(result.Leader, result.Team.ID) || result.Project.TeamID != result.Team.ID || result.Project.OwnerUserID != result.Leader.ID || result.Project.CostCenter != req.CostCenterCode || len(result.Project.Teams) != 1 || stringField(result.ProjectMember.Fields, "role") != "owner" {
				t.Fatalf("incorrect onboarding bindings: %+v", result)
			}
			if loginAsTeamMemberActor(t, app, req.LeaderEmail, req.LeaderPassword) == "" {
				t.Fatal("leader cannot log in")
			}
			retry := doJSON(t, app, http.MethodPost, "/api/admin/customer-onboarding", req, token)
			if retry.Code != http.StatusOK || retry.Body != response.Body {
				t.Fatalf("retry differs: %d %s", retry.Code, retry.Body)
			}
			req.TeamName = "Different Team"
			conflict := doJSON(t, app, http.MethodPost, "/api/admin/customer-onboarding", req, token)
			if conflict.Code != http.StatusConflict {
				t.Fatalf("expected 409, got %d", conflict.Code)
			}
			resources := store.ListResources("customer-onboarding")
			serialized, err := json.Marshal(resources)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(response.Body, req.LeaderPassword) || strings.Contains(string(serialized), req.LeaderPassword) || strings.Contains(string(serialized), "password_hash") {
				t.Fatal("response or receipt leaked credentials")
			}
			unauthenticated := httptest.NewRecorder()
			app.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodPost, "/api/admin/customer-onboarding", nil))
			if unauthenticated.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d", unauthenticated.Code)
			}
			wrongMethod := doJSON(t, app, http.MethodGet, "/api/admin/customer-onboarding", nil, token)
			if wrongMethod.Code != http.StatusMethodNotAllowed {
				t.Fatalf("expected 405, got %d", wrongMethod.Code)
			}
		})
	}
}

func TestCustomerOnboardingRollbackAndRetry(t *testing.T) {
	store := NewMemoryStore()
	// Fail the last binding insert, after the user and project have been created.
	callback := "test:onboarding-member-failure"
	if err := store.db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if resource, ok := tx.Statement.Dest.(*AdminResource); ok && resource.Kind == "project-members" {
			if err := tx.AddError(errors.New("injected membership failure")); err == nil {
				t.Fatal("expected membership failure to be added to the transaction")
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	req := onboardingRequest()
	if _, _, err := store.CreateCustomerOnboarding(context.Background(), req); err == nil {
		t.Fatal("expected injected failure")
	}
	for _, model := range []any{&AdminResource{}, &AdminUser{}, &Project{}, &ProjectTeam{}} {
		var count int64
		if err := store.db.Model(model).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("rollback left %d rows for %T", count, model)
		}
	}
	if err := store.db.Callback().Create().Remove(callback); err != nil {
		t.Fatal(err)
	}
	if _, replayed, err := store.CreateCustomerOnboarding(context.Background(), req); err != nil || replayed {
		t.Fatalf("retry after rollback failed: replayed=%v err=%v", replayed, err)
	}
	req.IdempotencyKey = "another-key"
	if _, _, err := store.CreateCustomerOnboarding(context.Background(), req); err == nil {
		t.Fatal("expected duplicate cost center conflict")
	}
	if len(store.ListResources("customer-onboarding")) != 1 {
		t.Fatal("failed request persisted a receipt")
	}
}

func TestCustomerOnboardingValidation(t *testing.T) {
	for _, field := range []string{"cost_center_code", "team_name", "email", "password", "key"} {
		t.Run(field, func(t *testing.T) {
			store := NewMemoryStore()
			req := onboardingRequest()
			switch field {
			case "cost_center_code":
				req.CostCenterCode = " "
			case "team_name":
				req.TeamName = ""
			case "email":
				req.LeaderEmail = "not-an-email"
			case "password":
				req.LeaderPassword = ""
			case "key":
				req.IdempotencyKey = ""
			}
			if _, _, err := store.CreateCustomerOnboarding(context.Background(), req); err == nil {
				t.Fatal("expected validation failure")
			}
			if len(store.ListResources("teams")) != 0 {
				t.Fatal("invalid request created a team")
			}
		})
	}
}

func TestCustomerOnboardingConcurrentReplay(t *testing.T) {
	store := NewMemoryStore()
	var wg sync.WaitGroup
	ids := make(chan string, 4)
	for range 4 {
		wg.Go(func() {
			result, _, err := store.CreateCustomerOnboarding(context.Background(), onboardingRequest())
			if err != nil {
				t.Errorf("concurrent onboarding failed: %v", err)
				return
			}
			ids <- result.Project.ID
		})
	}
	wg.Wait()
	close(ids)
	projectID := ""
	for id := range ids {
		if projectID != "" && projectID != id {
			t.Fatal("concurrent replay created another project")
		}
		projectID = id
	}
	if len(store.ListProjects()) != 1 || len(store.ListAdminUsers()) != 1 || len(store.ListResources("teams")) != 1 {
		t.Fatal("concurrent replay duplicated onboarding records")
	}
}
