package server

import "strings"

// Container names carry media type even when their child object has no MIME tag.
func redactAuditMediaContainer(key string, value any) any {
	normalized := strings.ToLower(strings.ReplaceAll(key, "_", ""))
	switch normalized {
	case "imageurl", "image", "video", "audio", "inputaudio", "outputaudio", "inlinedata":
		if text, ok := value.(string); ok {
			if strings.HasPrefix(strings.ToLower(strings.TrimSpace(text)), "data:") {
				return "[redacted]"
			}
		}
		if object, ok := value.(map[string]any); ok {
			if _, present := object["data"]; present {
				object["data"] = "[redacted]"
			}
		}
	}
	return value
}

// Media is described, not archived as encoded bytes in request diagnostics.
func isAuditMediaField(object map[string]any, key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "_", ""))
	switch normalized {
	case "b64json", "imagedata", "audiodata", "videodata":
		return true
	case "data":
		kind, _ := object["type"].(string)
		mime, _ := object["mime_type"].(string)
		if mime == "" {
			mime, _ = object["mimeType"].(string)
		}
		return kind == "base64" || kind == "input_audio" || strings.HasPrefix(mime, "image/") || strings.HasPrefix(mime, "audio/") || strings.HasPrefix(mime, "video/")
	}
	return false
}
