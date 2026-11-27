package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
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

func TestReviewAuditCopilotRuntimeSessionToken(t *testing.T) {
	for _, mode := range []string{"exchange", "cached", "refresh"} {
		t.Run(mode, func(t *testing.T) {
			exchanges := 0
			adapter, provider := copilotSubscriptionFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					exchanges++
					_, _ = fmt.Fprintf(w, `{"token":"synthetic-runtime-%d","expires_at":%d}`, exchanges, time.Now().Add(time.Hour).Unix())
					return
				}
				if mode == "refresh" && r.Header.Get("Authorization") == "Bearer synthetic-runtime-1" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"text\":\"synthetic-runtime-1 synthetic-runtime-2 synthetic-auto-token\"}\n\ndata: [DONE]\n\n")
			})
			if mode == "cached" {
				if _, err := adapter.session(t.Context(), ProviderResourceCredentials{AccessToken: "github-secret"}, false); err != nil {
					t.Fatal(err)
				}
			}
			tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
			ctx := tracker.auditContext(t.Context())
			ctx = context.WithValue(ctx, copilotSubscriptionAutoKey{}, copilotSubscriptionAutoSession{Token: "synthetic-auto-token"})
			response, err := adapter.request(ctx, provider, "/chat/completions", map[string]any{"stream": true}, true)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			wire, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			tracker.capture.add(wire)
			body, _ := auditPayloadBody(tracker.auditPayload(200, "", nil, provider))
			if strings.Contains(body, "synthetic-auto-token") || strings.Contains(body, "synthetic-runtime-1") {
				t.Fatal("Copilot runtime or Auto token remained in snapshot")
			}
			if mode == "refresh" && (exchanges != 2 || strings.Contains(body, "synthetic-runtime-2")) {
				t.Fatal("refreshed Copilot token was not captured")
			}
			if mode != "refresh" && exchanges != 1 {
				t.Fatal("session exchange count changed")
			}
		})
	}
}

func TestReviewAuditResponseMediaShapes(t *testing.T) {
	const audio = "c3ludGhldGljLWF1ZGlv"
	const image = "c3ludGhldGljLWltYWdl"
	value := map[string]any{"output": []any{
		map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_audio", "audio": audio, "format": "wav", "transcript": "Synthetic transcript"}}},
		map[string]any{"type": "image_generation_call", "result": image, "status": "completed"},
	}, "output_audio": map[string]any{"audio": audio, "format": "mp3"}, "result": "Keep ordinary tool output"}
	for _, stream := range []bool{false, true} {
		payload := any(value)
		if stream {
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
			tracker.capture.add([]byte("data: " + string(raw) + "\n\ndata: [DONE]\n\n"))
			payload = tracker.auditPayload(200, "", nil, Provider{})
		}
		body, _ := auditPayloadBody(payload)
		if !json.Valid([]byte(body)) || strings.Contains(body, audio) || strings.Contains(body, image) {
			t.Fatal("encoded response media remained in audit snapshot")
		}
		for _, text := range []string{"Synthetic transcript", "completed", "wav", "mp3", "Keep ordinary tool output"} {
			if !strings.Contains(body, text) {
				t.Fatal("media redaction discarded non-media metadata")
			}
		}
	}
	original, err := json.Marshal(value)
	if err != nil || !strings.Contains(string(original), audio) || !strings.Contains(string(original), image) {
		t.Fatal("audit redaction mutated response")
	}
}
