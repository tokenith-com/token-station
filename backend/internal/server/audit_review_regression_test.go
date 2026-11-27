package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestReviewAuditSSEEventNameRedactsProviderCredential(t *testing.T) {
	const secret = "synthetic-review-provider-secret"
	tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
	tracker.capture.add([]byte("event: " + secret + "\ndata: {\"usage\":{\"total_tokens\":1}}\n\n"))
	body, _ := auditPayloadBody(tracker.auditPayload(200, "", nil, Provider{APIKey: secret}))
	if strings.Contains(body, secret) {
		t.Fatal("provider credential remained in the persisted SSE event name")
	}
}

func TestReviewAuditInlineImageURLStringIsRedacted(t *testing.T) {
	const media = "data:image/png;base64,c3ludGhldGljLXJldmlldy1pbWFnZQ=="
	body, _ := auditPayloadBody(map[string]any{"contents": []any{map[string]any{"type": "image_url", "image_url": media}}})
	if strings.Contains(body, media) {
		t.Fatal("inline image bytes remained in the persisted image_url string")
	}
}

func TestReviewAuditUsesPreparedCredential(t *testing.T) {
	const secret = "synthetic-review-prepared-access-token"
	store := newTestMemoryStore(t)
	provider := store.AddProvider(Provider{Name: "Review provider", Type: ProviderChatGPTSubscription, Options: map[string]string{providerCredentialRefreshProfileOption: "review-refresh"}})
	store.ConfigureProviderResourceTypePolicy(map[string][]string{provider.Type: {ProviderResourceChatGPTSubscription}})
	store.ConfigureProviderCredentialRefreshHandlers([]providerResourceCredentialRefreshRegistration{{ProviderType: provider.Type, Profile: "review-refresh", Refresh: func(_ context.Context, credentials ProviderResourceCredentials) (ProviderResourceCredentials, error) {
		return credentials, nil
	}}})
	resource, err := store.AddProviderResource(ProviderResource{ProviderID: provider.ID, Name: "Review account", ResourceType: ProviderResourceChatGPTSubscription, Credentials: &ProviderResourceCredentials{AccessToken: secret}})
	if err != nil {
		t.Fatal(err)
	}
	candidate := RouteSelection{Provider: provider, Resource: &resource}
	server := &Server{store: store}
	tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
	prepared, err := server.prepareRouteForUpstream(tracker.auditContext(t.Context()), candidate)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Provider.APIKey != secret {
		t.Fatal("fixture did not prepare the runtime access token")
	}
	tracker.capture.add([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"" + prepared.Provider.APIKey + "\"}}]}\n\ndata: [DONE]\n\n"))
	body, _ := auditPayloadBody(tracker.auditPayload(200, "", nil, candidate.Provider))
	if strings.Contains(body, secret) {
		t.Fatal("prepared runtime access token remained in the snapshot when the handler used the original route provider")
	}
}

func TestReviewAuditBoundedSSEStillProducesValidJSON(t *testing.T) {
	event := map[string]any{}
	for i := 0; i < 20; i++ {
		event[fmt.Sprintf("field_%02d", i)] = "x"
	}
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
	tracker.capture.add([]byte(strings.Repeat("data: "+string(raw)+"\n\n", 120) + "data: [DONE]\n\n"))
	payload := tracker.auditPayload(200, "", nil, Provider{})
	if payload["truncated"] != false || payload["terminal_observed"] != true {
		t.Fatal("fixture did not fit within the SSE capture budget")
	}
	body, truncated := auditPayloadBody(payload)
	if !truncated || len(body) > auditPayloadMaxBytes || !json.Valid([]byte(body)) {
		t.Fatal("bounded SSE payload became invalid JSON after the storage byte limit")
	}
	var stored map[string]any
	if err := json.Unmarshal([]byte(body), &stored); err != nil {
		t.Fatal(err)
	}
	if stored["terminal_observed"] != true || stored["truncated"] != true || stored["capture_kind"] != "bounded_sse_events" || stored["status_code"] != float64(200) {
		t.Fatal("bounded snapshot lost SSE metadata")
	}
}

func TestReviewAuditRetainsRotatedAndAttemptCredentials(t *testing.T) {
	tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
	ctx := tracker.auditContext(t.Context())
	tracker.captureAuditProvider(Provider{APIKey: "attempt-before-refresh", Headers: map[string]string{"X-Private": "synthetic-private-header"}, SensitiveHeaders: []string{"X-Private"}})
	captureAuditCredentials(ctx, ProviderResourceCredentials{AccessToken: "attempt-after-refresh", RefreshToken: "synthetic-refresh-token"})
	tracker.captureAuditProvider(Provider{APIKey: "second-attempt-secret"})
	secrets := []string{"attempt-before-refresh", "synthetic-private-header", "attempt-after-refresh", "synthetic-refresh-token", "second-attempt-secret"}
	event, err := json.Marshal(map[string]any{"text": strings.Join(secrets, " ")})
	if err != nil {
		t.Fatal(err)
	}
	tracker.capture.add([]byte("data: " + string(event) + "\n\ndata: [DONE]\n\n"))
	body, _ := auditPayloadBody(tracker.auditPayload(502, "upstream_failed", fmt.Errorf("upstream rejected %s", secrets[2]), Provider{}))
	for _, secret := range secrets {
		if strings.Contains(body, secret) {
			t.Fatal("request-local audit capture leaked an attempted credential")
		}
	}
	if tracker.capture.credentials != nil || tracker.capture.raw != nil {
		t.Fatal("audit capture retained credentials or wire bytes")
	}
}

func TestReviewAuditMediaVariantsPreserveOriginal(t *testing.T) {
	for _, key := range []string{"image_url", "image", "audio", "input_audio", "inline_data", "video", "voice"} {
		t.Run(key, func(t *testing.T) {
			const media = "data:image/png;base64,c3ludGhldGljLW1lZGlh"
			value := map[string]any{key: media, "text": "Synthetic description"}
			body, _ := auditPayloadBody(value)
			if strings.Contains(body, media) || !strings.Contains(body, "Synthetic description") || value[key] != media {
				t.Fatal("media redaction leaked bytes, lost text or mutated input")
			}
		})
	}
}
