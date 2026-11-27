package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuditCopilotGatewayOmitsRuntimeTokenAndResponseMedia(t *testing.T) {
	const runtimeToken = "synthetic-copilot-runtime-audit-token"
	const audio = "c3ludGhldGljLWF1ZGlvLXJlc3BvbnNl"
	const image = "c3ludGhldGljLWltYWdlLXJlc3BvbnNl"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]any{"token": runtimeToken, "expires_at": time.Now().Add(time.Hour).Unix()})
		case "/models":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"id": "classified-model", "supported_endpoints": []string{"/chat/completions"}}}})
		case "/chat/completions":
			if r.Header.Get("Authorization") != "Bearer "+runtimeToken {
				t.Error("runtime credential was not used")
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"%s\"}}],\"output_audio\":{\"audio\":\"%s\",\"format\":\"wav\"},\"output\":[{\"type\":\"image_generation_call\",\"result\":\"%s\",\"status\":\"completed\"}]}\n\ndata: [DONE]\n\n", runtimeToken, audio, image)
		default:
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	server, store, key := classificationGateway(t, copilotSubscriptionBaseURL, copilotSubscriptionBaseURL, ProviderGitHubCopilotSubscription)
	t.Cleanup(func() { _ = server.Shutdown(context.Background()) })
	for _, resource := range store.ListProviderResources() {
		resource.ResourceType = ProviderResourceGitHubCopilotSubscription
		resource.Credentials = &ProviderResourceCredentials{AccessToken: "synthetic-github-account-token"}
		if _, err := store.UpdateProviderResource(resource.ID, resource); err != nil {
			t.Fatal(err)
		}
	}
	adapter := &CopilotSubscriptionAdapter{Client: upstream.Client(), StreamClient: upstream.Client(), CredentialRefreshClient: upstream.Client(), APIBaseURL: upstream.URL, TokenURL: upstream.URL + "/token", RefreshCredentials: store.RefreshProviderResourceCredentials}
	registerTestAdapter(server, ProviderGitHubCopilotSubscription, adapter)
	response := doJSON(t, server.Handler(), http.MethodPost, "/v1/chat/completions", map[string]any{"model": "classified-model", "messages": []any{map[string]any{"role": "user", "content": "Synthetic prompt"}}, "stream": true}, key)
	if response.Code != http.StatusOK || !strings.Contains(response.Body, runtimeToken) {
		t.Fatalf("stream delivery changed: status=%d", response.Code)
	}
	logs := store.ListRequestLogs()
	if len(logs) != 1 {
		t.Fatal("request was not recorded exactly once")
	}
	detail, err := store.GetRequestDetail(logs[0].RequestID)
	if err != nil {
		t.Fatal(err)
	}
	payload, ok := detail["payload"].(RequestPayloadLog)
	if !ok || !json.Valid([]byte(payload.ResponseBody)) || !strings.Contains(payload.ResponseBody, "bounded_sse_events") {
		t.Fatal("persisted SSE snapshot missing or invalid")
	}
	for _, secret := range []string{runtimeToken, audio, image} {
		if strings.Contains(payload.ResponseBody, secret) {
			t.Fatal("runtime credential or encoded response media leaked into persisted audit")
		}
	}
	if !strings.Contains(payload.ResponseBody, "completed") || !strings.Contains(payload.ResponseBody, "wav") {
		t.Fatal("media metadata was discarded")
	}
}
