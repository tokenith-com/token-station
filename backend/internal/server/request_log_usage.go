package server

import (
	"encoding/json"
	"strings"
)

func enrichRequestLogsWithUsage(logs []RequestLog, records []UsageRecord) []RequestLog {
	byRequestID := make(map[string]*RequestLog, len(logs))
	result := make([]RequestLog, len(logs))
	copy(result, logs)
	for index := range result {
		byRequestID[result[index].RequestID] = &result[index]
	}
	for _, record := range records {
		log := byRequestID[record.RequestID]
		if log == nil {
			continue
		}
		enrichRequestLogWithUsageRecord(log, record)
	}
	return result
}

func enrichRequestLogWithUsageRecord(log *RequestLog, record UsageRecord) {
	log.InputTokens += record.InputTokens
	log.CachedInputTokens += record.CachedInputTokens
	log.CacheWriteTokens += record.CacheWriteTokens
	log.CacheWrite5mTokens += record.CacheWrite5mTokens
	log.CacheWrite1hTokens += record.CacheWrite1hTokens
	log.InputAudioTokens += record.InputAudioTokens
	log.OutputTokens += record.OutputTokens
	log.ReasoningTokens += record.ReasoningTokens
	log.OutputAudioTokens += record.OutputAudioTokens
	log.AcceptedPredictionTokens += record.AcceptedPredictionTokens
	log.RejectedPredictionTokens += record.RejectedPredictionTokens
	log.TotalTokens += record.TotalTokens
	log.InputCostUSD += record.InputCostUSD
	log.CacheReadCostUSD += record.CacheReadCostUSD
	log.CacheWriteCostUSD += record.CacheWriteCostUSD
	log.OutputCostUSD += record.OutputCostUSD
	log.EstimatedCostUSD += record.CostUSD
	log.ProviderCostUSD += record.ProviderCostUSD
	log.UsageRecordCount++
}

func (s *Server) redactProviderCostsForUser(user AdminUser, detail map[string]any) {
	if s.canViewGlobalOperations(user) {
		return
	}
	if usage, ok := detail["usage"].([]UsageRecord); ok {
		for index := range usage {
			usage[index].ProviderCostUSD = 0
		}
		detail["usage"] = usage
	}
}

// accountDisplayName resolves the human label for the account a request was
// billed to. The detail payload carries it so a member can name the account
// without the identity permission that the user directory requires.
func (s *Server) accountDisplayName(log RequestLog) string {
	userID := strings.TrimSpace(log.AttributedUserID)
	if userID == "" {
		if key, ok := s.store.GetAPIKey(log.APIKeyID); ok {
			userID = strings.TrimSpace(usageAttributionUserID(key, Project{OwnerUserID: projectOwnerID(s.store, log.ProjectID)}))
		}
	}
	if userID == "" {
		userID = projectOwnerID(s.store, log.ProjectID)
	}
	if userID == "" {
		return ""
	}
	user, ok := s.findAdminUser(userID)
	if !ok {
		return userID
	}
	// Match the console's owner label: display name, falling back to username,
	// followed by the email address.
	name := strings.TrimSpace(user.Name)
	if name == "" {
		name = strings.TrimSpace(user.Username)
	}
	return strings.TrimSpace(strings.Join(nonEmptyStrings(name, user.Email), " / "))
}

func projectOwnerID(store Store, projectID string) string {
	if project, ok := store.GetProject(projectID); ok {
		return strings.TrimSpace(project.OwnerUserID)
	}
	return ""
}

func nonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}

// requestErrorDetailFromPayload extracts the diagnosis visible to every role:
// the upstream error message and whether routing rejected the call before an
// upstream attempt. Full body visibility is enforced by the detail handler.
func requestErrorDetailFromPayload(payload any) map[string]any {
	record, ok := payload.(RequestPayloadLog)
	if !ok || strings.TrimSpace(record.ResponseBody) == "" {
		return nil
	}
	var decoded struct {
		Error struct {
			Message string         `json:"message"`
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(record.ResponseBody), &decoded); err != nil {
		return nil
	}
	detail := map[string]any{}
	if message := strings.TrimSpace(decoded.Error.Message); message != "" {
		detail["message"] = message
	}
	stage, _ := decoded.Error.Details["stage"].(string)
	// Only known diagnostic stages may cross the body-visibility boundary.
	switch stage {
	case "route_selection", "validation", "upstream_connect", "upstream_read", "client_write", "settlement":
		detail["stage"] = stage
	}
	attempted, hasAttempted := decoded.Error.Details["upstream_attempted"].(bool)
	if stage == "route_selection" && hasAttempted && !attempted {
		detail["before_upstream"] = true
	}
	if len(detail) == 0 {
		return nil
	}
	return detail
}
