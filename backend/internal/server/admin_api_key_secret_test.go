package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func decodeAPIKeySecret(t *testing.T, body string) (string, string) {
	t.Helper()
	var payload struct {
		ID     string `json:"id"`
		APIKey string `json:"api_key"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode API key payload: %v: %s", err, body)
	}
	return payload.ID, payload.APIKey
}

func TestAdminAPIKeySecretRevealsCreatedAndRotatedKeys(t *testing.T) {
	store := NewMemoryStore()
	if err := BootstrapBaseData(store); err != nil {
		t.Fatal(err)
	}
	app := New(store).Handler()

	created := doJSON(t, app, http.MethodPost, "/api/admin/projects/"+defaultProjectID+"/keys", map[string]any{
		"name":           "revealable-key",
		"allowed_models": []string{"gpt-4.1-mini"},
	}, "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create key status = %d: %s", created.Code, created.Body)
	}
	keyID, rawKey := decodeAPIKeySecret(t, created.Body)

	var stored APIKey
	if err := store.db.First(&stored, "id = ?", keyID).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored.KeyCiphertext, "enc:v1:") || strings.Contains(stored.KeyCiphertext, rawKey) {
		t.Fatalf("stored ciphertext is not encrypted: %q", stored.KeyCiphertext)
	}

	revealed := doJSON(t, app, http.MethodGet, "/api/admin/api-keys/"+keyID+"/secret", nil, "")
	if revealed.Code != http.StatusOK {
		t.Fatalf("reveal status = %d: %s", revealed.Code, revealed.Body)
	}
	if got := revealed.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if id, secret := decodeAPIKeySecret(t, revealed.Body); id != keyID || secret != rawKey {
		t.Fatalf("revealed (%q, %q), want (%q, %q)", id, secret, keyID, rawKey)
	}

	listed := doJSON(t, app, http.MethodGet, "/api/admin/projects/"+defaultProjectID+"/keys", nil, "")
	if strings.Contains(listed.Body, rawKey) || strings.Contains(listed.Body, stored.KeyCiphertext) {
		t.Fatalf("key listing exposed secret material: %s", listed.Body)
	}

	rotated := doJSON(t, app, http.MethodPost, "/api/admin/api-keys/"+keyID+"/rotate", map[string]any{}, "")
	if rotated.Code != http.StatusCreated {
		t.Fatalf("rotate status = %d: %s", rotated.Code, rotated.Body)
	}
	rotatedID, rotatedKey := decodeAPIKeySecret(t, rotated.Body)
	revealedRotated := doJSON(t, app, http.MethodGet, "/api/admin/api-keys/"+rotatedID+"/secret", nil, "")
	if _, secret := decodeAPIKeySecret(t, revealedRotated.Body); revealedRotated.Code != http.StatusOK || secret != rotatedKey {
		t.Fatalf("rotated reveal = %d %s, want %s", revealedRotated.Code, revealedRotated.Body, rotatedKey)
	}
}

func TestAdminAPIKeySecretRejectsLegacyKeyWithoutCiphertext(t *testing.T) {
	store := NewMemoryStore()
	if err := BootstrapBaseData(store); err != nil {
		t.Fatal(err)
	}
	legacy := APIKey{ID: "key_legacy_secret", ProjectID: defaultProjectID, Name: "legacy", KeyHash: "legacy-hash", Status: StatusActive, CreatedAt: time.Now().UTC()}
	if err := store.db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	app := New(store).Handler()

	resp := doJSON(t, app, http.MethodGet, "/api/admin/api-keys/"+legacy.ID+"/secret", nil, "")
	if resp.Code != http.StatusConflict || !strings.Contains(resp.Body, "api_key_secret_unavailable") {
		t.Fatalf("legacy reveal = %d: %s", resp.Code, resp.Body)
	}
	missing := doJSON(t, app, http.MethodGet, "/api/admin/api-keys/key_missing/secret", nil, "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing reveal = %d: %s", missing.Code, missing.Body)
	}
	wrongMethod := doJSON(t, app, http.MethodPost, "/api/admin/api-keys/"+legacy.ID+"/secret", map[string]any{}, "")
	if wrongMethod.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST secret = %d: %s", wrongMethod.Code, wrongMethod.Body)
	}
}
