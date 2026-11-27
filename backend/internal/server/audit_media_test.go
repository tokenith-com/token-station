package server

import (
	"strings"
	"testing"
)

func TestAuditMediaOmitsCommonEncodedAudioFields(t *testing.T) {
	body, _ := auditPayloadBody(map[string]any{
		"audio":       map[string]any{"data": "synthetic-audio-bytes", "transcript": "Synthetic transcript"},
		"voice":       "data:audio/wav;base64,c3ludGhldGljLXZvaWNl",
		"input_audio": map[string]any{"data": "synthetic-input-bytes", "format": "wav"},
	})
	for _, secret := range []string{"synthetic-audio-bytes", "synthetic-input-bytes", "c3ludGhldGljLXZvaWNl"} {
		if strings.Contains(body, secret) {
			t.Fatalf("media bytes persisted: %s", body)
		}
	}
}
