package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestRoleConfigRejectsLegacyAdministratorKey(t *testing.T) {
	store := newTestMemoryStore(t)
	app := New(store)
	t.Cleanup(func() { _ = app.Shutdown(t.Context()) })
	handler := app.Handler()
	path := "/api/admin/resources/role-configs"

	role := AdminResource{
		ID: "custom-role", Name: "Security Reviewer",
		Fields: map[string]any{"role_key": "security_admin", "display_name": "Security Reviewer"},
	}
	created := doJSON(t, handler, http.MethodPost, path, role, "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create supported role: %d %s", created.Code, created.Body)
	}

	for _, input := range []AdminResource{
		{ID: "role-legacy", Name: "Legacy", Fields: map[string]any{"role_key": " SYSTEM_ADMIN "}},
		{ID: "system_admin", Name: "Legacy"},
	} {
		response := doJSON(t, handler, http.MethodPost, path, input, "")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body, "legacy_role_config") {
			t.Fatalf("create legacy role: %d %s", response.Code, response.Body)
		}
	}
	patch := AdminResource{Fields: map[string]any{"role_key": "system_admin"}}
	response := doJSON(t, handler, http.MethodPatch, path+"/"+role.ID, patch, "")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body, "legacy_role_config") {
		t.Fatalf("update to legacy role: %d %s", response.Code, response.Body)
	}
	roles := store.ListResources("role-configs")
	if len(roles) != 1 || roles[0].ID != role.ID || stringField(roles[0].Fields, "role_key") != "security_admin" {
		t.Fatalf("rejected requests changed saved roles: %+v", roles)
	}
}

func TestRoleConfigKeepsCanonicalPlatformAdminName(t *testing.T) {
	store := newTestMemoryStore(t)
	app := New(store)
	t.Cleanup(func() { _ = app.Shutdown(t.Context()) })
	handler := app.Handler()
	path := "/api/admin/resources/role-configs"

	role := AdminResource{
		ID: "role_admin", Name: "Custom name",
		Fields: map[string]any{"role_key": " ADMIN ", "display_name": "Custom label", "assignable": true},
	}
	check := func(response responseBody, status int) {
		t.Helper()
		if response.Code != status {
			t.Fatalf("save admin role: %d %s", response.Code, response.Body)
		}
		var saved AdminResource
		if err := json.Unmarshal([]byte(response.Body), &saved); err != nil {
			t.Fatal(err)
		}
		if saved.Name != platformAdminDisplayName || stringField(saved.Fields, "display_name") != platformAdminDisplayName ||
			stringField(saved.Fields, "role_key") != "admin" || saved.Fields["assignable"] != true {
			t.Fatalf("unexpected saved admin role: %+v", saved)
		}
	}
	check(doJSON(t, handler, http.MethodPost, path, role, ""), http.StatusCreated)
	check(doJSON(t, handler, http.MethodPatch, path+"/"+role.ID, AdminResource{Name: "Another name"}, ""), http.StatusOK)
}
