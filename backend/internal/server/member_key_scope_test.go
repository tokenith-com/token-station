package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

type memberKeyFixture struct {
	app       http.Handler
	server    *Server
	token     string
	memberID  string
	leaderID  string
	projectID string
}

func newMemberKeyFixture(t *testing.T) memberKeyFixture {
	t.Helper()
	store := newTestMemoryStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_m", Name: "M", Status: StatusActive})
	leader, err := store.CreateAdminUser(AdminUser{
		Username: "leader", Name: "Leader", Email: "leader@m.local", Role: "team_leader", TeamID: "team_m", Status: StatusActive,
	}, "leader123456")
	if err != nil {
		t.Fatal(err)
	}
	member, err := store.CreateAdminUser(AdminUser{
		Username: "member", Name: "Member", Email: "member@m.local", Role: "user", TeamID: "team_m", Status: StatusActive,
	}, "member123456")
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProjectChecked(Project{ID: "prj_m", Name: "Team Project", TeamID: "team_m", OwnerUserID: leader.ID, Status: StatusActive})
	if err != nil {
		t.Fatal(err)
	}
	store.CreateResource("project-members", AdminResource{
		Name: "Member", Status: StatusActive,
		Fields: map[string]any{"project_id": project.ID, "user_id": member.ID, "role": "developer", "can_issue_keys": true},
	})
	app := newManagedTestServer(t, store).Handler()
	login := doJSON(t, app, http.MethodPost, "/api/admin/auth/login", map[string]any{"identity": "member@m.local", "password": "member123456"}, "")
	if login.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", login.Code, login.Body)
	}
	var auth struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(login.Body), &auth); err != nil {
		t.Fatal(err)
	}
	return memberKeyFixture{app: app, server: newManagedTestServer(t, store), token: auth.Token, memberID: member.ID, leaderID: leader.ID, projectID: project.ID}
}

func TestMemberCreatesKeyWithOnlyAName(t *testing.T) {
	f := newMemberKeyFixture(t)
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/api-keys", map[string]any{"name": "My key"}, f.token)
	if created.Code != http.StatusCreated {
		t.Fatalf("member key create = %d %s", created.Code, created.Body)
	}
	var key APIKey
	if err := json.Unmarshal([]byte(created.Body), &key); err != nil {
		t.Fatal(err)
	}
	if key.ProjectID != f.projectID {
		t.Fatalf("project = %q, want the team project", key.ProjectID)
	}
	if key.OwnerUserID != f.memberID {
		t.Fatalf("owner = %q, want the member", key.OwnerUserID)
	}
}

func TestMemberCannotChangeKeyQuotaOrScope(t *testing.T) {
	f := newMemberKeyFixture(t)
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/api-keys", map[string]any{"name": "My key"}, f.token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create failed: %d %s", created.Code, created.Body)
	}
	var key APIKey
	if err := json.Unmarshal([]byte(created.Body), &key); err != nil {
		t.Fatal(err)
	}
	for _, body := range []map[string]any{
		{"limits": map[string]any{"daily_requests": 100000}},
		{"rate_limit_rpm": 100000},
		{"model_access_mode": "inherit", "allowed_models": []string{"gpt"}},
		{"expires_at": "2030-01-01T00:00:00Z"},
	} {
		patch := doJSON(t, f.app, http.MethodPatch, "/api/admin/api-keys/"+key.ID, body, f.token)
		if patch.Code != http.StatusForbidden || !strings.Contains(patch.Body, "api_key_scope_forbidden") {
			t.Fatalf("member patch %v = %d %s, want 403 api_key_scope_forbidden", body, patch.Code, patch.Body)
		}
	}
	// Renaming and disabling stay available.
	rename := doJSON(t, f.app, http.MethodPatch, "/api/admin/api-keys/"+key.ID, map[string]any{"name": "Renamed"}, f.token)
	if rename.Code != http.StatusOK {
		t.Fatalf("member rename = %d %s", rename.Code, rename.Body)
	}
	disable := doJSON(t, f.app, http.MethodPatch, "/api/admin/api-keys/"+key.ID, map[string]any{"status": "disabled"}, f.token)
	if disable.Code != http.StatusOK {
		t.Fatalf("member disable = %d %s", disable.Code, disable.Body)
	}
}

func TestMemberKeyListOnlyShowsOwnKeys(t *testing.T) {
	f := newMemberKeyFixture(t)
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/api-keys", map[string]any{"name": "Mine"}, f.token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create failed: %d %s", created.Code, created.Body)
	}
	// A key owned by the team leader in the same project must stay hidden.
	store := f.server.store.(*GormStore)
	if _, _, err := store.CreateAPIKey(f.projectID, APIKey{Name: "Leaders key", OwnerUserID: f.leaderID, Status: StatusActive}, ""); err != nil {
		t.Fatal(err)
	}
	list := doJSON(t, f.app, http.MethodGet, "/api/admin/api-keys", nil, f.token)
	if list.Code != http.StatusOK {
		t.Fatalf("list failed: %d %s", list.Code, list.Body)
	}
	if strings.Contains(list.Body, "Leaders key") {
		t.Fatalf("member list leaked a peer key: %s", list.Body)
	}
	if !strings.Contains(list.Body, "Mine") {
		t.Fatalf("member list missing own key: %s", list.Body)
	}
}
