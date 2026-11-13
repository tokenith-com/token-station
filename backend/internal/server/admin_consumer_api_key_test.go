package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestConsumerCreatesPersonalAPIKeyWithoutProject(t *testing.T) {
	store := NewMemoryStore()
	guest, err := store.CreateAdminUser(AdminUser{
		Username: "consumer-key-guest",
		Name:     "Consumer Key Guest",
		Email:    "consumer-key-guest@tokenhub.local",
		Role:     "guest",
		Status:   StatusActive,
	}, "guest123456")
	if err != nil {
		t.Fatal(err)
	}
	store.CreateProject(Project{ID: defaultProjectID, Name: "Default Project Space", Status: StatusActive})
	store.CreateProject(Project{ID: consumerProjectID, Name: "Consumer Project", Status: StatusActive})
	store.CreateProject(Project{Name: "Unrelated Team Project", Status: StatusActive})
	_, session, err := store.CreateAdminSession(guest.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	app := New(store).Handler()

	created := doJSON(t, app, http.MethodPost, "/api/admin/api-keys", map[string]any{"name": "My Consumer Key"}, session.Token)
	if created.Code != http.StatusCreated {
		t.Fatalf("consumer key create failed: %d %s", created.Code, created.Body)
	}
	var key struct {
		ID          string `json:"id"`
		APIKey      string `json:"api_key"`
		ProjectID   string `json:"project_id"`
		OwnerUserID string `json:"owner_user_id"`
	}
	if err := json.Unmarshal([]byte(created.Body), &key); err != nil {
		t.Fatal(err)
	}
	if key.APIKey == "" || key.ProjectID != consumerProjectID || key.OwnerUserID != guest.ID {
		t.Fatalf("unexpected consumer key: %#v", key)
	}

	listed := doJSON(t, app, http.MethodGet, "/api/admin/api-keys", nil, session.Token)
	if listed.Code != http.StatusOK {
		t.Fatalf("consumer list keys failed: %d %s", listed.Code, listed.Body)
	}
	var payload struct {
		Data []APIKey `json:"data"`
	}
	if err := json.Unmarshal([]byte(listed.Body), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 1 || payload.Data[0].ID != key.ID {
		t.Fatalf("consumer should see exactly its own key, got %#v", payload.Data)
	}
}

func TestPlaygroundAPIKeyMustBelongToCaller(t *testing.T) {
	store := NewMemoryStore()
	store.CreateProject(Project{ID: consumerProjectID, Name: "Consumer Project", Status: StatusActive})
	key, _, err := store.CreateAPIKey(consumerProjectID, APIKey{Name: "playground", Status: StatusActive, OwnerUserID: "usr_guest"}, "thk_playground_owner")
	if err != nil {
		t.Fatal(err)
	}
	server := New(store)

	project, resolved, err := server.resolvePlaygroundAPIKey(AdminUser{ID: "usr_guest", Role: "guest"}, key.ID)
	if err != nil || project.ID != consumerProjectID || resolved.ID != key.ID {
		t.Fatalf("owner should resolve its key: project=%q key=%q err=%v", project.ID, resolved.ID, err)
	}
	for _, tc := range []struct {
		name string
		user AdminUser
		id   string
		code string
	}{
		{name: "missing key", user: AdminUser{ID: "usr_guest", Role: "guest"}, id: "", code: "missing_api_key"},
		{name: "other user", user: AdminUser{ID: "usr_other", Role: "user"}, id: key.ID, code: "api_key_not_found"},
		{name: "admin is not owner", user: AdminUser{ID: "usr_admin", Role: "superadmin"}, id: key.ID, code: "api_key_not_found"},
		{name: "unknown key", user: AdminUser{ID: "usr_guest", Role: "guest"}, id: "key_missing", code: "api_key_not_found"},
	} {
		if _, _, err := server.resolvePlaygroundAPIKey(tc.user, tc.id); AsHTTPError(err).Code != tc.code {
			t.Fatalf("%s: got %v, want %s", tc.name, err, tc.code)
		}
	}
}
