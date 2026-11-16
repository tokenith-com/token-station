package server

import (
	"encoding/json"
	"net/http"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestAdminOverviewModelsRespectProjectAccess(t *testing.T) {
	for _, tc := range []struct {
		name     string
		role     string
		access   string
		mode     string
		allowed  []string
		excluded []string
		union    bool
		want     []string
	}{
		{name: "restricted ordinary member", access: "developer", mode: ModelAccessModeRestricted, allowed: []string{"model-a", "disabled", "unrouted", "inactive-route"}, want: []string{"model-a"}},
		{name: "excluded viewer member", access: "viewer", mode: ModelAccessModeExcluded, excluded: []string{"model-a"}, want: []string{"model-b"}},
		{name: "inherit member", access: "developer", mode: ModelAccessModeInherit, want: []string{"model-a", "model-b"}},
		{name: "restricted owner", access: "owner", mode: ModelAccessModeRestricted, allowed: []string{"model-a"}, want: []string{"model-a"}},
		{name: "restricted team member", access: "team", mode: ModelAccessModeRestricted, allowed: []string{"model-b"}, want: []string{"model-b"}},
		{name: "multiple project union", access: "developer", mode: ModelAccessModeRestricted, allowed: []string{"model-a"}, union: true, want: []string{"model-a", "model-b"}},
		{name: "empty restricted member", access: "developer", mode: ModelAccessModeRestricted, want: []string{}},
		{name: "inactive membership", access: "inactive", mode: ModelAccessModeInherit, want: []string{}},
		{name: "no accessible project", mode: ModelAccessModeInherit, want: []string{}},
		{name: "platform admin unchanged", role: "admin", want: []string{"disabled", "inactive-route", "model-a", "model-b", "unrouted"}},
		{name: "system admin unchanged", role: "system_admin", want: []string{"disabled", "inactive-route", "model-a", "model-b", "unrouted"}},
		{name: "global operations unchanged", role: "security_admin", want: []string{"disabled", "inactive-route", "model-a", "model-b", "unrouted"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestMemoryStore(t)
			for _, name := range []string{"model-a", "model-b", "disabled", "unrouted", "inactive-route"} {
				store.AddModel(Model{Name: name, Status: StatusActive})
				if name != "unrouted" {
					routeStatus := StatusActive
					if name == "inactive-route" {
						routeStatus = StatusDisabled
					}
					store.AddRoute(ModelRoute{ModelName: name, Status: routeStatus})
				}
			}
			role := tc.role
			if role == "" {
				role = "user"
			}
			store.CreateResource("teams", AdminResource{ID: "catalog-team", Name: "Catalog team", Status: StatusActive})
			user, err := store.CreateAdminUser(AdminUser{
				Username: "catalog-user", Email: "catalog@example.test", Name: "Catalog user",
				Role: role, TeamID: "catalog-team", Status: StatusActive,
			}, "test-password-123")
			if err != nil {
				t.Fatal(err)
			}
			project := Project{Name: "Catalog project", ModelAccessMode: tc.mode, AllowedModels: tc.allowed, ExcludedModels: tc.excluded}
			if tc.access == "owner" {
				project.OwnerUserID = user.ID
			}
			if tc.access == "team" {
				project.TeamID = user.TeamID
			}
			project, err = store.CreateProjectChecked(project)
			if err != nil {
				t.Fatal(err)
			}
			if tc.access == "developer" || tc.access == "viewer" || tc.access == "inactive" {
				status, memberRole := StatusActive, tc.access
				if tc.access == "inactive" {
					status, memberRole = StatusDisabled, "developer"
				}
				store.CreateResource("project-members", AdminResource{Name: "Catalog member", Status: status, Fields: map[string]any{
					"project_id": project.ID, "user_id": user.ID, "role": memberRole,
				}})
			}
			if tc.union {
				if _, err := store.CreateProjectChecked(Project{Name: "Second project", OwnerUserID: user.ID,
					ModelAccessMode: ModelAccessModeExcluded, ExcludedModels: []string{"model-a"},
				}); err != nil {
					t.Fatal(err)
				}
			}
			if tc.access == "team" {
				if err := store.db.Model(&ProjectTeam{}).Where("project_id = ? AND team_id = ?", project.ID, user.TeamID).Update("role", "viewer").Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := store.db.Model(&Model{}).Where("name = ?", "disabled").Update("status", StatusDisabled).Error; err != nil {
				t.Fatal(err)
			}
			// An unrelated inherited project must not widen the user's model set.
			store.CreateProject(Project{Name: "Unrelated project", OwnerUserID: "another-user"})
			_, session, err := store.CreateAdminSession(user.ID, time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			app := newManagedTestServer(t, store).Handler()
			response := doJSON(t, app, http.MethodGet, "/api/admin/overview", nil, session.Token)
			if response.Code != http.StatusOK {
				t.Fatalf("overview status = %d: %s", response.Code, response.Body)
			}
			var payload struct {
				Models []Model `json:"models"`
			}
			if err := json.Unmarshal([]byte(response.Body), &payload); err != nil {
				t.Fatal(err)
			}
			got := make([]string, 0, len(payload.Models))
			for _, model := range payload.Models {
				got = append(got, model.Name)
			}
			sort.Strings(got)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("overview models = %v, want %v", got, tc.want)
			}
		})
	}
}
