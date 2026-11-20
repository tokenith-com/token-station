package server

import (
	"testing"
)

func userModelAccessResources(t *testing.T, store *GormStore, userID, mode string, models ...string) {
	t.Helper()
	fields := map[string]any{"user_id": userID, "model_access_mode": mode}
	if mode == ModelAccessModeRestricted {
		fields["allowed_models"] = models
	}
	if mode == ModelAccessModeExcluded {
		fields["excluded_models"] = models
	}
	store.CreateResource(userModelAccessResourceKind, AdminResource{
		Name: "scope-" + userID, Status: StatusActive, Fields: fields,
	})
}

func TestUserModelAccessNarrowsProjectScope(t *testing.T) {
	store := NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	userModelAccessResources(t, store, "usr_limited", ModelAccessModeRestricted, "model-a")

	access := userModelAccessFor(store.ListResources(userModelAccessResourceKind), "usr_limited")
	if !access.Configured || access.Mode != ModelAccessModeRestricted {
		t.Fatalf("scope not resolved: %+v", access)
	}
	if reasons := userModelAccessReasons(access, "model-a"); len(reasons) != 0 {
		t.Fatalf("allowed model rejected: %v", reasons)
	}
	if reasons := userModelAccessReasons(access, "model-b"); len(reasons) != 1 || reasons[0] != "user_model_not_allowed" {
		t.Fatalf("unlisted model accepted: %v", reasons)
	}
}

func TestUserModelAccessWithoutRecordInherits(t *testing.T) {
	store := NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	access := userModelAccessFor(store.ListResources(userModelAccessResourceKind), "usr_unconfigured")
	if access.Configured {
		t.Fatalf("missing record must not configure a scope: %+v", access)
	}
	if reasons := userModelAccessReasons(access, "any-model"); len(reasons) != 0 {
		t.Fatalf("unconfigured user was restricted: %v", reasons)
	}
}

func TestUserModelAccessExcludedMode(t *testing.T) {
	store := NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	userModelAccessResources(t, store, "usr_blocked", ModelAccessModeExcluded, "model-b")
	access := userModelAccessFor(store.ListResources(userModelAccessResourceKind), "usr_blocked")
	if reasons := userModelAccessReasons(access, "model-b"); len(reasons) != 1 || reasons[0] != "user_model_excluded" {
		t.Fatalf("excluded model accepted: %v", reasons)
	}
	if reasons := userModelAccessReasons(access, "model-a"); len(reasons) != 0 {
		t.Fatalf("other model rejected: %v", reasons)
	}
}

// The project boundary stays outermost: a user scope cannot grant a model the
// project already rejects, and the key scope still applies underneath both.
func TestModelAccessReasonsAppliesAllThreeScopes(t *testing.T) {
	project := Project{ModelAccessMode: ModelAccessModeRestricted, AllowedModels: []string{"model-a", "model-b"}}
	key := APIKey{ModelAccessMode: ModelAccessModeRestricted, AllowedModels: map[string]bool{"model-a": true}}
	scope := userModelAccess{Configured: true, Mode: ModelAccessModeRestricted, Allowed: map[string]bool{"model-b": true}}

	cases := []struct {
		model    string
		expected []string
	}{
		{"model-c", []string{"project_model_not_allowed"}},
		{"model-b", nil},
		{"model-a", nil},
	}
	for _, tc := range cases {
		reasons := modelAccessReasonsWithUser(project, key, scope, tc.model)
		// Every scope that rejects the model reports its own reason, so assert the
		// decisive one is present rather than that it is the only one.
		switch tc.model {
		case "model-a":
			if !containsReason(reasons, "user_model_not_allowed") {
				t.Fatalf("%s: expected the user scope to reject, got %v", tc.model, reasons)
			}
		case "model-b":
			if !containsReason(reasons, "api_key_model_not_allowed") {
				t.Fatalf("%s: expected the key scope to reject, got %v", tc.model, reasons)
			}
			if containsReason(reasons, "user_model_not_allowed") {
				t.Fatalf("%s: the user scope allows this model, got %v", tc.model, reasons)
			}
		default:
			if !containsReason(reasons, "project_model_not_allowed") {
				t.Fatalf("%s: expected the project scope to reject, got %v", tc.model, reasons)
			}
		}
	}
}

func containsReason(reasons []string, want string) bool {
	for _, reason := range reasons {
		if reason == want {
			return true
		}
	}
	return false
}

// The admin form submits a multi-select as a comma-separated string, so the
// resolver has to read that shape rather than only a JSON array.
func TestUserModelAccessReadsCommaSeparatedModelList(t *testing.T) {
	store := NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	store.CreateResource(userModelAccessResourceKind, AdminResource{
		Name: "scope-csv", Status: StatusActive,
		Fields: map[string]any{"user_id": "usr_csv", "model_access_mode": ModelAccessModeRestricted, "allowed_models": "model-a, model-b"},
	})
	access := userModelAccessFor(store.ListResources(userModelAccessResourceKind), "usr_csv")
	if !access.Configured || len(access.Allowed) != 2 || !access.Allowed["model-a"] || !access.Allowed["model-b"] {
		t.Fatalf("comma-separated scope not resolved: %+v", access)
	}
	if reasons := userModelAccessReasons(access, "model-c"); len(reasons) != 1 {
		t.Fatalf("unlisted model accepted: %v", reasons)
	}
}
