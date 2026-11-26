package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestAuditStreamCapturePreservesWireAndRedactsStoredEvents(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"content\":\"hello fixture-provider-secret\"}}],\"api_key\":\"fixture-user-secret\",\"usage\":{\"total_tokens\":7},\"image\":{\"b64_json\":\"fixture-image-bytes\"}}\n\ndata: [DONE]\n\n"
	var wire bytes.Buffer
	tracker := &streamWriteTracker{writer: &wire, capture: &auditStreamCapture{}}
	for _, part := range []string{stream[:13], stream[13:80], stream[80:]} {
		if _, err := tracker.Write([]byte(part)); err != nil {
			t.Fatal(err)
		}
	}
	if wire.String() != stream {
		t.Fatal("capture changed wire output")
	}
	payload := tracker.auditPayload(200, "", nil, Provider{APIKey: "fixture-provider-secret"})
	body, truncated := auditPayloadBody(payload)
	if truncated || !json.Valid([]byte(body)) {
		t.Fatalf("invalid capture: %s", body)
	}
	for _, secret := range []string{"fixture-provider-secret", "fixture-user-secret", "fixture-image-bytes"} {
		if strings.Contains(body, secret) {
			t.Fatalf("capture leaked %s", secret)
		}
	}
	if payload["captured"] != true || payload["terminal_observed"] != true || payload["truncated"] != false {
		t.Fatalf("capture = %+v", payload)
	}
	if !strings.Contains(body, "total_tokens") || len(tracker.capture.raw) != 0 {
		t.Fatal("usage lost or raw buffer retained")
	}
}

func TestAuditStreamCaptureDoesNotPersistPartialOrInvalidFrames(t *testing.T) {
	for _, stream := range []string{"data: secret-invalid\n\n", "data: {\"password\":\"secret-partial\"}", strings.Repeat("x", auditStreamCaptureBytes+100)} {
		tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
		tracker.capture.add([]byte(stream))
		body, _ := auditPayloadBody(tracker.auditPayload(499, "request_cancelled", context.Canceled, Provider{}))
		if strings.Contains(body, "secret-") || len(body) > auditPayloadMaxBytes {
			t.Fatalf("unsafe capture: %s", body)
		}
		if len(tracker.capture.raw) != 0 {
			t.Fatal("raw buffer retained")
		}
	}
}

func TestAuditStreamCaptureProtocolTerminalsAndBounds(t *testing.T) {
	for _, stream := range []string{"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n", "data: {\"candidates\":[{\"finishReason\":\"STOP\"}]}\n\n"} {
		tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
		tracker.capture.add([]byte(stream))
		if payload := tracker.auditPayload(200, "", nil, Provider{}); payload["terminal_observed"] != true {
			t.Fatalf("terminal = %v", payload)
		}
	}
	tracker := &streamWriteTracker{capture: &auditStreamCapture{}}
	tracker.capture.add([]byte(strings.Repeat("data: {\"delta\":\"x\"}\n\n", auditStreamEventCount+10)))
	payload := tracker.auditPayload(200, "", nil, Provider{})
	if payload["truncated"] != true || len(payload["events"].([]map[string]any)) > auditStreamEventCount || payload["terminal_observed"] != false {
		t.Fatalf("bounds = %v", payload)
	}
}

type auditPartialWriter struct{}

func (auditPartialWriter) Write(p []byte) (int, error) { return len(p) / 2, io.ErrClosedPipe }
func TestAuditCaptureOnlyRecordsWrittenBytes(t *testing.T) {
	tracker := &streamWriteTracker{writer: auditPartialWriter{}, capture: &auditStreamCapture{}}
	data := []byte("data: {\"secret\":\"not-complete\"}\n\n")
	n, err := tracker.Write(data)
	if err != io.ErrClosedPipe || len(tracker.capture.raw) != n {
		t.Fatal("write accounting changed")
	}
	p := tracker.auditPayload(499, "request_cancelled", err, Provider{})
	if p["captured"] != false || p["terminal_observed"] != false {
		t.Fatalf("partial = %v", p)
	}
}
