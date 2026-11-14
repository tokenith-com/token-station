package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func loginAsTeamMemberActor(t *testing.T, app http.Handler, email string, password string) string {
	t.Helper()
	login := doJSON(t, app, http.MethodPost, "/api/admin/auth/login", map[string]any{
		"identity": email,
		"password": password,
	}, "")
	if login.Code != http.StatusOK {
		t.Fatalf("login failed for %s: %d %s", email, login.Code, login.Body)
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(login.Body), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Token
}

func TestTeamLeaderCreatesMemberAssignedToFirstManageableProject(t *testing.T) {
	store := newTestMemoryStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_alpha", Name: "Alpha Team", Status: StatusActive})
	store.CreateResource("teams", AdminResource{ID: "team_beta", Name: "Beta Team", Status: StatusActive})
	leader, err := store.CreateAdminUser(AdminUser{
		Username: "alpha-leader",
		Name:     "Alpha Leader",
		Email:    "alpha-leader@tokenhub.local",
		Role:     "team_leader",
		TeamID:   "team_alpha",
		Status:   StatusActive,
	}, "leader123456")
	if err != nil {
		t.Fatal(err)
	}
	firstProject := store.CreateProject(Project{Name: "Alpha First Project", TeamID: "team_alpha"})
	store.CreateProject(Project{Name: "Alpha Second Project", TeamID: "team_alpha"})
	otherProject := store.CreateProject(Project{Name: "Beta Project", TeamID: "team_beta"})
	app := newManagedTestServer(t, store).Handler()
	token := loginAsTeamMemberActor(t, app, leader.Email, "leader123456")

	created := doJSON(t, app, http.MethodPost, "/api/admin/team-members", map[string]any{
		"username": "alpha-member",
		"name":     "Alpha Member",
		"email":    "alpha-member@tokenhub.local",
		"password": "member123456",
	}, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", created.Code, created.Body)
	}
	var response struct {
		User            AdminUser `json:"user"`
		ProjectID       string    `json:"project_id"`
		ProjectMemberID string    `json:"project_member_id"`
	}
	if err := json.Unmarshal([]byte(created.Body), &response); err != nil {
		t.Fatal(err)
	}
	if response.User.ID == "" || normalizeAdminRole(response.User.Role) != "user" || response.User.TeamID != "team_alpha" {
		t.Fatalf("unexpected created user: %+v", response.User)
	}
	if response.ProjectID != firstProject.ID {
		t.Fatalf("expected first manageable project %s, got %s", firstProject.ID, response.ProjectID)
	}
	if response.ProjectID == otherProject.ID {
		t.Fatalf("member must not land in another team project: %s", created.Body)
	}
	member, ok := findProjectMember(store.ListResources("project-members"), firstProject.ID, response.User.ID)
	if !ok {
		t.Fatalf("expected project membership for %s in %s", response.User.ID, firstProject.ID)
	}
	if member.ID != response.ProjectMemberID {
		t.Fatalf("response member id %s does not match stored %s", response.ProjectMemberID, member.ID)
	}
	if got := strings.TrimSpace(stringField(member.Fields, "role")); got != "developer" {
		t.Fatalf("expected default developer role, got %q", got)
	}
	if strings.TrimSpace(stringField(member.Fields, "provisioned_by")) != "team_member_create" {
		t.Fatalf("unexpected provisioned_by: %+v", member.Fields)
	}
}

func TestTeamLeaderCreateMemberWithoutManageableProject(t *testing.T) {
	store := newTestMemoryStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_alpha", Name: "Alpha Team", Status: StatusActive})
	store.CreateResource("teams", AdminResource{ID: "team_beta", Name: "Beta Team", Status: StatusActive})
	leader, err := store.CreateAdminUser(AdminUser{
		Username: "lonely-leader",
		Name:     "Lonely Leader",
		Email:    "lonely-leader@tokenhub.local",
		Role:     "team_leader",
		TeamID:   "team_alpha",
		Status:   StatusActive,
	}, "leader123456")
	if err != nil {
		t.Fatal(err)
	}
	store.CreateProject(Project{Name: "Beta Only Project", TeamID: "team_beta"})
	app := newManagedTestServer(t, store).Handler()
	token := loginAsTeamMemberActor(t, app, leader.Email, "leader123456")

	created := doJSON(t, app, http.MethodPost, "/api/admin/team-members", map[string]any{
		"username": "orphan-member",
		"email":    "orphan-member@tokenhub.local",
		"password": "member123456",
	}, token)
	if created.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", created.Code, created.Body)
	}
	for _, user := range store.ListAdminUsers() {
		if user.Username == "orphan-member" {
			t.Fatalf("user must not be created when no project space is available")
		}
	}
}

func TestAdminCreatesMemberWithExplicitTeam(t *testing.T) {
	store := newTestMemoryStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_alpha", Name: "Alpha Team", Status: StatusActive})
	if _, err := store.CreateAdminUser(AdminUser{
		Username: "platform-admin",
		Name:     "Platform Admin",
		Email:    "platform-admin@tokenhub.local",
		Role:     "admin",
		Status:   StatusActive,
	}, "admin123456"); err != nil {
		t.Fatal(err)
	}
	project := store.CreateProject(Project{Name: "Alpha Project", TeamID: "team_alpha"})
	app := newManagedTestServer(t, store).Handler()
	token := loginAsTeamMemberActor(t, app, "platform-admin@tokenhub.local", "admin123456")

	missingTeam := doJSON(t, app, http.MethodPost, "/api/admin/team-members", map[string]any{
		"username": "no-team-member",
		"email":    "no-team-member@tokenhub.local",
		"password": "member123456",
	}, token)
	if missingTeam.Code != http.StatusBadRequest {
		t.Fatalf("admin without team_id should get 400, got %d: %s", missingTeam.Code, missingTeam.Body)
	}

	created := doJSON(t, app, http.MethodPost, "/api/admin/team-members", map[string]any{
		"username":     "admin-member",
		"email":        "admin-member@tokenhub.local",
		"password":     "member123456",
		"team_id":      "team_alpha",
		"project_role": "viewer",
	}, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", created.Code, created.Body)
	}
	var response struct {
		User      AdminUser `json:"user"`
		ProjectID string    `json:"project_id"`
	}
	if err := json.Unmarshal([]byte(created.Body), &response); err != nil {
		t.Fatal(err)
	}
	if response.User.TeamID != "team_alpha" || response.ProjectID != project.ID {
		t.Fatalf("unexpected admin-created member: %s", created.Body)
	}
	member, ok := findProjectMember(store.ListResources("project-members"), project.ID, response.User.ID)
	if !ok {
		t.Fatalf("expected project membership for admin-created member")
	}
	if got := strings.TrimSpace(stringField(member.Fields, "role")); got != "viewer" {
		t.Fatalf("expected viewer role override, got %q", got)
	}
}

func TestTeamMemberCreateRejectsUnauthorizedRoles(t *testing.T) {
	store := newTestMemoryStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_alpha", Name: "Alpha Team", Status: StatusActive})
	store.CreateProject(Project{Name: "Alpha Project", TeamID: "team_alpha"})
	if _, err := store.CreateAdminUser(AdminUser{
		Username: "sec-admin",
		Email:    "sec-admin@tokenhub.local",
		Role:     "security_admin",
		Status:   StatusActive,
	}, "security123456"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAdminUser(AdminUser{
		Username: "plain-user",
		Email:    "plain-user@tokenhub.local",
		Role:     "user",
		TeamID:   "team_alpha",
		Status:   StatusActive,
	}, "user123456"); err != nil {
		t.Fatal(err)
	}
	app := newManagedTestServer(t, store).Handler()

	for _, credentials := range [][2]string{
		{"sec-admin@tokenhub.local", "security123456"},
		{"plain-user@tokenhub.local", "user123456"},
	} {
		token := loginAsTeamMemberActor(t, app, credentials[0], credentials[1])
		created := doJSON(t, app, http.MethodPost, "/api/admin/team-members", map[string]any{
			"username": "blocked-member",
			"email":    "blocked-member@tokenhub.local",
			"password": "member123456",
		}, token)
		if created.Code != http.StatusForbidden {
			t.Fatalf("%s should get 403, got %d: %s", credentials[0], created.Code, created.Body)
		}
	}
}

func TestTeamLeaderCannotCreateMemberForOtherTeam(t *testing.T) {
	store := newTestMemoryStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_alpha", Name: "Alpha Team", Status: StatusActive})
	store.CreateResource("teams", AdminResource{ID: "team_beta", Name: "Beta Team", Status: StatusActive})
	leader, err := store.CreateAdminUser(AdminUser{
		Username: "alpha-leader-2",
		Email:    "alpha-leader-2@tokenhub.local",
		Role:     "team_leader",
		TeamID:   "team_alpha",
		Status:   StatusActive,
	}, "leader123456")
	if err != nil {
		t.Fatal(err)
	}
	store.CreateProject(Project{Name: "Alpha Project", TeamID: "team_alpha"})
	app := newManagedTestServer(t, store).Handler()
	token := loginAsTeamMemberActor(t, app, leader.Email, "leader123456")

	created := doJSON(t, app, http.MethodPost, "/api/admin/team-members", map[string]any{
		"username": "cross-team-member",
		"email":    "cross-team-member@tokenhub.local",
		"password": "member123456",
		"team_id":  "team_beta",
	}, token)
	if created.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", created.Code, created.Body)
	}
}
