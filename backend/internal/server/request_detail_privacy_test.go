package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// The request detail must never return prompt or completion bodies, but the
// stored rows stay intact and the error diagnosis still reaches the console.
func TestRequestDetailOmitsPayloadButKeepsDiagnosis(t *testing.T) {
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
	resp := doJSON(t, app, http.MethodGet, "/api/admin/audit/requests/"+call.RequestID, nil, "")
	if resp.Code != http.StatusOK {
		t.Fatalf("detail: %d %s", resp.Code, resp.Body)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatal(err)
	}
	if _, present := body["payload"]; present {
		t.Fatalf("payload must not be returned: %s", resp.Body)
	}
	if !strings.Contains(resp.Body, "no route") {
		t.Fatalf("diagnosis message missing: %s", resp.Body)
	}
	if strings.Contains(resp.Body, "SECRET PROMPT") {
		t.Fatalf("request body leaked: %s", resp.Body)
	}
	if detail, ok := body["error_detail"].(map[string]any); !ok || detail["before_upstream"] != true {
		t.Fatalf("error_detail = %v", body["error_detail"])
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
