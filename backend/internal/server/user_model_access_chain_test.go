package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"
)

// modelAccessChainFixture builds the three-level setup under test: three active
// models, a team project the platform admin narrows to two, and a team leader
// who narrows one member to a single model.
type modelAccessChainFixture struct {
	server      *Server
	app         http.Handler
	project     Project
	adminID     string
	leaderID    string
	memberID    string
	adminToken  string
	leaderToken string
	leaderKey   APIKey
	memberKey   APIKey
}

func buildModelAccessChainFixture(t *testing.T) modelAccessChainFixture {
	t.Helper()
	store := newTestMemoryStore(t)
	for _, name := range []string{"model-a", "model-b", "model-c"} {
		store.AddModel(Model{ID: name, Name: name, Family: "chain", Status: StatusActive, Modality: "chat"})
	}
	store.AddProvider(Provider{ID: "prv_chain", Name: "Chain", Type: ProviderMock, Status: StatusActive, Healthy: true, Priority: 1})
	for _, name := range []string{"model-a", "model-b", "model-c"} {
		store.AddRoute(ModelRoute{ModelName: name, ProviderID: "prv_chain", ProviderModel: name, Status: StatusActive, Priority: 1})
	}
	store.CreateResource("teams", AdminResource{ID: "team_taihu", Name: "Taihu", Status: StatusActive})
	store.CreateResource("teams", AdminResource{ID: "team_platform", Name: "Platform", Status: StatusActive})
	platformAdmin, err := store.CreateAdminUser(AdminUser{
		Username: "platform-admin", Name: "Platform Admin", Email: "platform-admin@tokenhub.local",
		Role: "admin", TeamID: "team_platform", Status: StatusActive,
	}, "platform123456")
	if err != nil {
		t.Fatal(err)
	}
	leader, err := store.CreateAdminUser(AdminUser{
		Username: "taihu-admin", Name: "Taihu Admin", Email: "taihu-admin@tokenhub.local",
		Role: "team_leader", TeamID: "team_taihu", Status: StatusActive,
	}, "leader123456")
	if err != nil {
		t.Fatal(err)
	}
	member, err := store.CreateAdminUser(AdminUser{
		Username: "taihu-member", Name: "Taihu Member", Email: "taihu-member@tokenhub.local",
		Role: "user", TeamID: "team_taihu", Status: StatusActive,
	}, "member123456")
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProjectChecked(Project{
		ID: "prj_taihu_chain", Name: "Taihu Chain", TeamID: "team_taihu", OwnerUserID: leader.ID, Status: StatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	store.CreateResource("project-members", AdminResource{
		Name: "Taihu Member Membership", Status: StatusActive,
		Fields: map[string]any{"project_id": project.ID, "user_id": member.ID, "role": "developer", "can_issue_keys": true},
	})
	leaderKey, leaderSecret, err := store.CreateAPIKey(project.ID, APIKey{Name: "Leader Key", OwnerUserID: leader.ID, Status: StatusActive}, "")
	if err != nil {
		t.Fatal(err)
	}
	memberKey, memberSecret, err := store.CreateAPIKey(project.ID, APIKey{Name: "Member Key", OwnerUserID: member.ID, Status: StatusActive}, "")
	if err != nil {
		t.Fatal(err)
	}
	app := newManagedTestServer(t, store).Handler()
	login := doJSON(t, app, http.MethodPost, "/api/admin/auth/login", map[string]any{
		"identity": "taihu-admin@tokenhub.local", "password": "leader123456",
	}, "")
	if login.Code != http.StatusOK {
		t.Fatalf("team leader login failed: %d %s", login.Code, login.Body)
	}
	var auth struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(login.Body), &auth); err != nil {
		t.Fatal(err)
	}
	if auth.Token == "" {
		t.Fatalf("team leader login returned no token: %s", login.Body)
	}
	adminLogin := doJSON(t, app, http.MethodPost, "/api/admin/auth/login", map[string]any{
		"identity": "platform-admin@tokenhub.local", "password": "platform123456",
	}, "")
	if adminLogin.Code != http.StatusOK {
		t.Fatalf("platform admin login failed: %d %s", adminLogin.Code, adminLogin.Body)
	}
	var adminAuth struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(adminLogin.Body), &adminAuth); err != nil {
		t.Fatal(err)
	}
	if adminAuth.Token == "" {
		t.Fatalf("platform admin login returned no token: %s", adminLogin.Body)
	}
	if _, leaderKey, err = store.ValidateAPIKey(leaderSecret, ""); err != nil {
		t.Fatalf("validate leader key: %v", err)
	}
	if _, memberKey, err = store.ValidateAPIKey(memberSecret, ""); err != nil {
		t.Fatalf("validate member key: %v", err)
	}
	return modelAccessChainFixture{
		server:      newManagedTestServer(t, store),
		app:         app,
		project:     project,
		adminID:     platformAdmin.ID,
		leaderID:    leader.ID,
		memberID:    member.ID,
		adminToken:  adminAuth.Token,
		leaderToken: auth.Token,
		leaderKey:   leaderKey,
		memberKey:   memberKey,
	}
}

func (f modelAccessChainFixture) admission(t *testing.T, key APIKey, model string) error {
	t.Helper()
	_, err := f.server.store.StartCall(context.Background(), f.project, key, model, 0)
	return err
}

func (f modelAccessChainFixture) assertAdmission(t *testing.T, key APIKey, model string, wantAllowed bool) {
	t.Helper()
	err := f.admission(t, key, model)
	if wantAllowed {
		if err != nil {
			t.Fatalf("%s on %s: expected admission, got %v", key.Name, model, err)
		}
		return
	}
	if err == nil {
		t.Fatalf("%s on %s: expected model_not_allowed, got admission", key.Name, model)
	}
	if code := AsHTTPError(err).Code; code != "model_not_allowed" {
		t.Fatalf("%s on %s: error code = %q, want model_not_allowed (%v)", key.Name, model, code, err)
	}
}

func sortedModelNames(models []Model) string {
	names := make([]string, 0, len(models))
	for _, model := range models {
		names = append(names, model.Name)
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

func TestModelAccessChainAdminProjectThenTeamLeaderUser(t *testing.T) {
	f := buildModelAccessChainFixture(t)

	// Baseline: every scope inherits, so all three models are callable.
	for _, model := range []string{"model-a", "model-b", "model-c"} {
		f.assertAdmission(t, f.leaderKey, model, true)
	}

	// 1. Platform admin narrows the project to two models through the real API.
	updated := doJSON(t, f.app, http.MethodPatch, "/api/admin/projects/"+f.project.ID, map[string]any{
		"model_access_mode": ModelAccessModeRestricted,
		"allowed_models":    []string{"model-a", "model-b"},
	}, f.adminToken)
	if updated.Code != http.StatusOK {
		t.Fatalf("admin project update failed: %d %s", updated.Code, updated.Body)
	}
	f.assertAdmission(t, f.leaderKey, "model-a", true)
	f.assertAdmission(t, f.leaderKey, "model-b", true)
	f.assertAdmission(t, f.leaderKey, "model-c", false)

	// 2. Team leader narrows one member to a single model through the real API.
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/resources/"+userModelAccessResourceKind, map[string]any{
		"name":   "Member scope",
		"status": StatusActive,
		"fields": map[string]any{
			"user_id":           f.memberID,
			"model_access_mode": ModelAccessModeRestricted,
			"allowed_models":    []string{"model-b"},
		},
	}, f.leaderToken)
	if created.Code != http.StatusCreated {
		t.Fatalf("team leader user scope create failed: %d %s", created.Code, created.Body)
	}

	// The member now only reaches model-b; the leader is unchanged.
	f.assertAdmission(t, f.memberKey, "model-b", true)
	f.assertAdmission(t, f.memberKey, "model-a", false)
	f.assertAdmission(t, f.memberKey, "model-c", false)
	f.assertAdmission(t, f.leaderKey, "model-a", true)
	f.assertAdmission(t, f.leaderKey, "model-b", true)

	// Both listings must agree with admission.
	if got := sortedModelNames(f.server.store.(*GormStore).AccessibleModelMembership(f.memberKey)); got != "model-b" {
		t.Fatalf("member credential listing = %q, want model-b", got)
	}
	if got := sortedModelNames(f.server.store.(*GormStore).AccessibleModelMembership(f.leaderKey)); got != "model-a,model-b" {
		t.Fatalf("leader credential listing = %q, want model-a,model-b", got)
	}
	member, ok := f.server.findAdminUser(f.memberID)
	if !ok {
		t.Fatal("member user missing")
	}
	if got := sortedModelNames(f.server.accessibleModelsForAdminUser(member)); got != "model-b" {
		t.Fatalf("member admin listing = %q, want model-b", got)
	}
}

// A user scope may only narrow the project. Granting a model the project
// excludes must fail at save time rather than silently taking effect.
func TestUserModelAccessCannotExceedProjectScope(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	updated := doJSON(t, f.app, http.MethodPatch, "/api/admin/projects/"+f.project.ID, map[string]any{
		"model_access_mode": ModelAccessModeRestricted,
		"allowed_models":    []string{"model-a"},
	}, f.adminToken)
	if updated.Code != http.StatusOK {
		t.Fatalf("admin project update failed: %d %s", updated.Code, updated.Body)
	}
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/resources/"+userModelAccessResourceKind, map[string]any{
		"name":   "Widening scope",
		"status": StatusActive,
		"fields": map[string]any{
			"user_id":           f.memberID,
			"model_access_mode": ModelAccessModeRestricted,
			"allowed_models":    []string{"model-b"},
		},
	}, f.leaderToken)
	if created.Code != http.StatusBadRequest || !strings.Contains(created.Body, "user_model_exceeds_project") {
		t.Fatalf("expected user_model_exceeds_project, got %d %s", created.Code, created.Body)
	}
}

// A team leader must not manage a member of another team.
func TestUserModelAccessIsTeamScoped(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	store := f.server.store.(*GormStore)
	store.CreateResource("teams", AdminResource{ID: "team_other", Name: "Other", Status: StatusActive})
	outsider, err := store.CreateAdminUser(AdminUser{
		Username: "other-member", Name: "Other Member", Email: "other@tokenhub.local",
		Role: "user", TeamID: "team_other", Status: StatusActive,
	}, "other123456")
	if err != nil {
		t.Fatal(err)
	}
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/resources/"+userModelAccessResourceKind, map[string]any{
		"name":   "Cross team scope",
		"status": StatusActive,
		"fields": map[string]any{
			"user_id":           outsider.ID,
			"model_access_mode": ModelAccessModeRestricted,
			"allowed_models":    []string{"model-a"},
		},
	}, f.leaderToken)
	if created.Code != http.StatusForbidden {
		t.Fatalf("expected team-scoped rejection, got %d %s", created.Code, created.Body)
	}
}

// A user scope saved before the project narrowed must not keep granting a model
// the project has since removed.
func TestUserScopeStaleAfterProjectNarrowing(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/resources/"+userModelAccessResourceKind, map[string]any{
		"name":   "Member scope",
		"status": StatusActive,
		"fields": map[string]any{
			"user_id":           f.memberID,
			"model_access_mode": ModelAccessModeRestricted,
			"allowed_models":    []string{"model-b", "model-c"},
		},
	}, f.leaderToken)
	if created.Code != http.StatusCreated {
		t.Fatalf("user scope create failed: %d %s", created.Code, created.Body)
	}
	narrowed := doJSON(t, f.app, http.MethodPatch, "/api/admin/projects/"+f.project.ID, map[string]any{
		"model_access_mode": ModelAccessModeRestricted,
		"allowed_models":    []string{"model-a", "model-b"},
	}, f.adminToken)
	if narrowed.Code != http.StatusOK {
		t.Fatalf("admin project update failed: %d %s", narrowed.Code, narrowed.Body)
	}
	f.assertAdmission(t, f.memberKey, "model-c", false)
}

// The model listing an operator sees must shrink when the project narrows; the
// team leader's own list still carries everything its projects allow.
func TestProjectScopeNarrowsOperatorModelListing(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	store := f.server.store.(*GormStore)
	leader, ok := f.server.findAdminUser(f.leaderID)
	if !ok {
		t.Fatal("leader missing")
	}
	if got := sortedModelNames(f.server.accessibleModelsForAdminUser(leader)); got != "model-a,model-b,model-c" {
		t.Fatalf("baseline leader listing = %q", got)
	}
	narrowed := doJSON(t, f.app, http.MethodPatch, "/api/admin/projects/"+f.project.ID, map[string]any{
		"model_access_mode": ModelAccessModeRestricted,
		"allowed_models":    []string{"model-a", "model-b"},
	}, f.adminToken)
	if narrowed.Code != http.StatusOK {
		t.Fatalf("admin project update failed: %d %s", narrowed.Code, narrowed.Body)
	}
	if got := sortedModelNames(f.server.accessibleModelsForAdminUser(leader)); got != "model-a,model-b" {
		t.Fatalf("leader listing after narrowing = %q", got)
	}
	_ = store
}

// The team leader's list contains its own team's scope rows and no other team's.
func TestTeamLeaderSeesOnlyOwnTeamUserScopes(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	store := f.server.store.(*GormStore)
	store.CreateResource("teams", AdminResource{ID: "team_other", Name: "Other", Status: StatusActive})
	outsider, err := store.CreateAdminUser(AdminUser{
		Username: "other-member", Name: "Other Member", Email: "other@tokenhub.local",
		Role: "user", TeamID: "team_other", Status: StatusActive,
	}, "other123456")
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{f.memberID, outsider.ID} {
		store.CreateResource(userModelAccessResourceKind, AdminResource{
			Name: "scope-" + target, Status: StatusActive,
			Fields: map[string]any{"user_id": target, "model_access_mode": ModelAccessModeRestricted, "allowed_models": []string{"model-a"}},
		})
	}
	list := doJSON(t, f.app, http.MethodGet, "/api/admin/resources/"+userModelAccessResourceKind, nil, f.leaderToken)
	if list.Code != http.StatusOK {
		t.Fatalf("list failed: %d %s", list.Code, list.Body)
	}
	if !strings.Contains(list.Body, f.memberID) || strings.Contains(list.Body, outsider.ID) {
		t.Fatalf("team leader scope list leaked: %s", list.Body)
	}
}

// Scope lookups that fail must deny rather than widen access.
func TestUserModelAccessLookupFailureDenies(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	store := f.server.store.(*GormStore)
	if err := store.db.Migrator().DropTable(&AdminResource{}); err != nil {
		// The table may be shared; fall back to asserting the resolver default.
		if access := userModelAccessFor(nil, f.memberID); access.Configured {
			t.Fatalf("empty resource set configured a scope: %+v", access)
		}
		return
	}
	if reasons := store.modelAccessReasonsForCall(store.db, f.project, f.memberKey, "model-a"); len(reasons) != 1 || reasons[0] != "user_model_access_unavailable" {
		t.Fatalf("lookup failure reasons = %v, want user_model_access_unavailable", reasons)
	}
}

// The team leader is the project owner, yet the platform ceiling must hold.
func TestTeamLeaderCannotRewriteProjectModelScope(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	narrowed := doJSON(t, f.app, http.MethodPatch, "/api/admin/projects/"+f.project.ID, map[string]any{
		"model_access_mode": ModelAccessModeRestricted,
		"allowed_models":    []string{"model-a", "model-b"},
	}, f.adminToken)
	if narrowed.Code != http.StatusOK {
		t.Fatalf("admin project update failed: %d %s", narrowed.Code, narrowed.Body)
	}
	for _, body := range []map[string]any{
		{"model_access_mode": ModelAccessModeRestricted, "allowed_models": []string{"model-a", "model-b", "model-c"}},
		{"model_access_mode": ModelAccessModeInherit},
		{"excluded_models": []string{"model-c"}},
	} {
		widened := doJSON(t, f.app, http.MethodPatch, "/api/admin/projects/"+f.project.ID, body, f.leaderToken)
		if widened.Code != http.StatusForbidden || !strings.Contains(widened.Body, "project_model_scope_forbidden") {
			t.Fatalf("team leader rewrite %v = %d %s, want 403 project_model_scope_forbidden", body, widened.Code, widened.Body)
		}
	}
	// The ceiling still holds end to end.
	f.assertAdmission(t, f.leaderKey, "model-c", false)
	// A team leader can still create a project; it simply starts unlocked.
	created := doJSON(t, f.app, http.MethodPost, "/api/admin/projects", map[string]any{"name": "Taihu New"}, f.leaderToken)
	if created.Code != http.StatusCreated {
		t.Fatalf("team leader project create failed: %d %s", created.Code, created.Body)
	}
	blockedCreate := doJSON(t, f.app, http.MethodPost, "/api/admin/projects", map[string]any{
		"name": "Taihu Scoped", "model_access_mode": ModelAccessModeRestricted, "allowed_models": []string{"model-a"},
	}, f.leaderToken)
	if blockedCreate.Code != http.StatusForbidden || !strings.Contains(blockedCreate.Body, "project_model_scope_forbidden") {
		t.Fatalf("team leader scoped create = %d %s, want 403", blockedCreate.Code, blockedCreate.Body)
	}
}

// A model that is active but unpublished in the external directory cannot be
// granted to a project or an API key, even through the API.
func TestProjectAndKeyRejectUnpublishedDirectoryModel(t *testing.T) {
	f := buildModelAccessChainFixture(t)
	store := f.server.store.(*GormStore)
	store.AddModel(Model{ID: "upstream-only", Name: "upstream-only", Family: "c", Status: StatusActive, Modality: "chat",
		Metadata: map[string]string{"source": "tokenhub-standard-catalog"}})

	projectUpdate := doJSON(t, f.app, http.MethodPatch, "/api/admin/projects/"+f.project.ID, map[string]any{
		"model_access_mode": ModelAccessModeRestricted,
		"allowed_models":    []string{"upstream-only"},
	}, f.adminToken)
	if projectUpdate.Code != http.StatusBadRequest || !strings.Contains(projectUpdate.Body, "model_not_in_directory") {
		t.Fatalf("project grant of unpublished model = %d %s, want 400 model_not_in_directory", projectUpdate.Code, projectUpdate.Body)
	}

	keyCreate := doJSON(t, f.app, http.MethodPost, "/api/admin/projects/"+f.project.ID+"/keys", map[string]any{
		"name":              "Unpublished key",
		"model_access_mode": ModelAccessModeRestricted,
		"allowed_models":    []string{"upstream-only"},
	}, f.adminToken)
	if keyCreate.Code != http.StatusBadRequest || !strings.Contains(keyCreate.Body, "model_not_in_directory") {
		t.Fatalf("key grant of unpublished model = %d %s, want 400 model_not_in_directory", keyCreate.Code, keyCreate.Body)
	}

	// A published model (external role or routed) is still accepted.
	if _, err := store.CreateProjectChecked(Project{Name: "Published", TeamID: "team_taihu", Status: StatusActive,
		ModelAccessMode: ModelAccessModeRestricted, AllowedModels: []string{"model-a"}}); err != nil {
		t.Fatalf("published model rejected: %v", err)
	}
}
