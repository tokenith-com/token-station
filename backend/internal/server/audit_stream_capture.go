package server

import (
	"bytes"
	"encoding/json"
	"io"
	"reflect"
	"strings"
)

const auditStreamCaptureBytes = 128 << 10
const auditStreamEventBytes = 40 << 10
const auditStreamEventCount = 128

// auditStreamCapture is observational only. It never changes stream writes or
// propagates parsing errors to a caller. Raw bytes live only in this bounded
// request-local buffer; only complete, redacted events reach persistent storage.
type auditStreamCapture struct {
	raw       []byte
	truncated bool
}

func (c *auditStreamCapture) add(data []byte) {
	remaining := auditStreamCaptureBytes - len(c.raw)
	if len(data) > remaining {
		data = data[:remaining]
		c.truncated = true
	}
	c.raw = append(c.raw, data...)
}

func (w *streamWriteTracker) auditPayload(status int, code string, streamErr error, provider Provider) map[string]any {
	payload := auditStreamPayload(status, code, streamErr)
	if w.capture == nil {
		return payload
	}
	c := w.capture
	events := make([]map[string]any, 0)
	decoder := newSSEDecoder(bytes.NewReader(c.raw))
	decoder.assembler.limit = auditStreamEventBytes
	size := 0
	terminal := false
	for {
		frame, err := decoder.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			c.truncated = true
			break
		}
		// An EOF-dispatched partial frame may contain credentials or invalid JSON.
		if !bytes.HasSuffix(frame.Raw, []byte("\n\n")) && !bytes.HasSuffix(frame.Raw, []byte("\r\n\r\n")) {
			if strings.TrimSpace(frame.Data) != "" {
				c.truncated = true
			}
			continue
		}
		if frame.Data == "" {
			continue
		}
		var data any
		if strings.TrimSpace(frame.Data) == "[DONE]" {
			data = "[DONE]"
		} else {
			if err := json.Unmarshal(redactProviderErrorSecrets([]byte(frame.Data), provider), &data); err != nil {
				data = map[string]any{"omitted": "invalid_or_incomplete_event"}
			}
		}
		budget := auditPayloadScanBudget
		if !auditPayloadFits(reflect.ValueOf(data), &budget, 0) {
			data = map[string]any{"omitted": "event_exceeds_audit_limit"}
			c.truncated = true
		}
		data = redactAuditValue(data)
		item := map[string]any{"event": frame.Event, "data": data}
		encoded, err := json.Marshal(item)
		if err != nil || size+len(encoded) > auditStreamEventBytes || len(events) >= auditStreamEventCount {
			c.truncated = true
			break
		}
		events = append(events, item)
		size += len(encoded)
		if text, ok := data.(string); ok && text == "[DONE]" {
			terminal = true
		}
		if obj, ok := data.(map[string]any); ok {
			kind, _ := obj["type"].(string)
			if kind == "message_stop" || kind == "response.completed" {
				terminal = true
			}
			// Native Gemini uses finishReason rather than a standalone sentinel.
			if candidates, ok := obj["candidates"].([]any); ok {
				for _, candidate := range candidates {
					if value, ok := candidate.(map[string]any); ok && value["finishReason"] != nil {
						terminal = true
					}
				}
			}
		}
	}
	payload["captured"] = len(events) > 0
	payload["capture_kind"] = "bounded_sse_events"
	payload["events"] = events
	payload["terminal_observed"] = terminal
	payload["truncated"] = c.truncated
	c.raw = nil
	return payload
}
