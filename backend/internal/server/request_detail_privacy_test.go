package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Only platform administrators receive snapshots; all roles retain diagnosis.
func TestRequestDetailPayloadVisibilityByRole(t *testing.T) {
	store := newTestMemoryStore(t)
	store.AddModel(Model{ID: "m", Name: "m", Family: "x", Status: StatusActive, Modality: "chat"})
	store.AddProvider(Provider{ID: "prv", Name: "P", Type: ProviderMock, Status: StatusActive, Healthy: true, Priority: 1})
	project, err := store.CreateProjectChecked(Project{ID: "prj", Name: "P", Status: StatusActive})
	if err != nil {
		t.Fatal(err)
	}
	key, _, err := store.CreateAPIKey(project.ID, APIKey{Name: "K", Status: StatusActive}, "")
	if err != nil {
		t.Fatal(err)
	}
	call, err := store.StartCall(context.Background(), project, key, "m", 0)
	if err != nil {
		t.Fatal(err)
	}
	store.FinishCall(call, RouteSelection{Provider: Provider{ID: "prv"}, ProviderModel: "m"}, Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5, CostUSD: 0.01}, 501, "provider_capability_not_supported", "", "")
	if err := store.db.Create(&RequestPayloadLog{
		ID: "body", RequestID: call.RequestID,
		RequestBody:  `{"messages":[{"role":"user","content":"SECRET PROMPT"}]}`,
		ResponseBody: `{"error":{"message":"no route","details":{"stage":"route_selection","upstream_attempted":false}}}`,
	}).Error; err != nil {
		t.Fatal(err)
	}

	app := newManagedTestServer(t, store).Handler()
	for _, role := range []string{"admin", "security_admin", "team_leader", "user", "consumer"} {
		t.Run(role, func(t *testing.T) {
			user, err := store.CreateAdminUser(AdminUser{Username: "privacy-" + role, Name: role, Email: role + "@example.test", Role: role, Status: StatusActive}, "privacy-fixture-password")
			if err != nil {
				t.Fatal(err)
			}
			// Give every role access to this key so this tests body visibility,
			// not an unrelated resource-authorization denial.
			if err := store.db.Model(&APIKey{}).Where("id = ?", key.ID).Update("owner_user_id", user.ID).Error; err != nil {
				t.Fatal(err)
			}
			_, session, err := store.CreateAdminSession(user.ID, time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			resp := doJSON(t, app, http.MethodGet, "/api/admin/audit/requests/"+call.RequestID, nil, session.Token)
			if resp.Code != http.StatusOK {
				t.Fatalf("detail: %d %s", resp.Code, resp.Body)
			}
			var body map[string]any
			if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
				t.Fatal(err)
			}
			_, present := body["payload"]
			if present != (role == "admin") {
				t.Fatalf("payload visibility for %s = %v", role, present)
			}
			if strings.Contains(resp.Body, "SECRET PROMPT") != (role == "admin") {
				t.Fatalf("unexpected request body visibility for %s", role)
			}
			if role == "admin" {
				payload, ok := body["payload"].(map[string]any)
				if !ok || !strings.Contains(payload["response_body"].(string), "no route") {
					t.Fatal("response snapshot missing")
				}
			}
			if detail, ok := body["error_detail"].(map[string]any); !ok || detail["before_upstream"] != true || detail["message"] != "no route" {
				t.Fatalf("error_detail = %v", body["error_detail"])
			}
		})
	}
	// The bodies remain stored.
	detail, err := store.GetRequestDetail(call.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if detail["payload"] == nil {
		t.Fatal("payload row must remain in storage")
	}
}
