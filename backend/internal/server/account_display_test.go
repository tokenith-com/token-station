package server

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestRequestDetailReturnsBillingAccountName(t *testing.T) {
	store := newTestMemoryStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_a", Name: "A", Status: StatusActive})
	member, err := store.CreateAdminUser(AdminUser{
		Username: "pt", Name: "太湖员工A", Email: "pt@locol.com", Role: "user", TeamID: "team_a", Status: StatusActive,
	}, "member123456")
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProjectChecked(Project{ID: "prj_a", Name: "太湖", TeamID: "team_a", OwnerUserID: member.ID, Status: StatusActive})
	if err != nil {
		t.Fatal(err)
	}
	store.AddModel(Model{ID: "m", Name: "m", Family: "x", Status: StatusActive, Modality: "chat"})
	key, _, err := store.CreateAPIKey(project.ID, APIKey{Name: "K", OwnerUserID: member.ID, Status: StatusActive}, "")
	if err != nil {
		t.Fatal(err)
	}
	call, err := store.StartCall(context.Background(), project, key, "m", 0)
	if err != nil {
		t.Fatal(err)
	}
	store.FinishCall(call, RouteSelection{Provider: Provider{ID: "prv_x"}, ProviderModel: "m"}, Usage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2, CostUSD: 0.01}, 200, "", "", "")
	logs := store.ListRequestLogs()
	if len(logs) == 0 {
		t.Fatal("no request log recorded")
	}
	if got := newManagedTestServer(t, store).accountDisplayName(logs[0]); got != "太湖员工A / pt@locol.com" {
		t.Fatalf("account display name = %q", got)
	}
}

func TestRequestDetailRejectsUnreadableDetail(t *testing.T) {
	store := newTestMemoryStore(t)
	app := newManagedTestServer(t, store).Handler()
	resp := doJSON(t, app, http.MethodGet, "/api/admin/audit/requests/missing", nil, "")
	if resp.Code != http.StatusNotFound || !strings.Contains(resp.Body, "request_not_found") {
		t.Fatalf("missing detail = %d %s", resp.Code, resp.Body)
	}
}
