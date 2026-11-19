package server

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"
	"tokenhub/backend/internal/metering"
)

type prepaidChatContextKey struct{}

func prepaidDispatchContext(ctx context.Context, call CallContext) (context.Context, context.CancelFunc) {
	if call.walletPayer == "" {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, 30*time.Minute)
}

func prepaidAPIPayer(tx *gorm.DB, key APIKey, project Project) (string, error) {
	ownerID := strings.TrimSpace(key.OwnerUserID)
	candidates := []string{ownerID}
	if ownerID == "" {
		candidates = []string{strings.TrimSpace(key.Metadata["created_by"]), strings.TrimSpace(project.OwnerUserID)}
	}
	var owners []AdminUser
	if err := tx.Select("id", "role", "status").Where("id IN ?", candidates).Find(&owners).Error; err != nil {
		return "", err
	}
	for _, owner := range owners {
		if normalizeAdminRole(owner.Role) != "consumer" {
			continue
		}
		if ownerID == "" || owner.Status != StatusActive {
			return "", NewHTTPError(403, "wallet_payer_unavailable", "An active personal API key owner is required")
		}
		return owner.ID, nil
	}
	return "", nil
}

func (s *Server) reserveChatWallet(ctx context.Context, call CallContext, request *ChatCompletionRequest) error {
	if call.walletPayer == "" {
		return nil
	}
	if call.Model.ID == "" || call.Model.Status != StatusActive ||
		call.Model.pricingUnavailable || (call.Model.Modality != "" && call.Model.Modality != "chat") {
		return walletUsageError()
	}
	resolved := modelPriceAt(call.Model, call.StartedAt)
	if (resolved.InputPriceUSDPer1M <= 0 || resolved.OutputPriceUSDPer1M <= 0) && resolved.Metadata["pricing_status"] != "configured" {
		return walletUsageError()
	}
	return s.payments.store.reserveWalletUsage(ctx, call, 0, 0)
}

// Called with the final payload after any gateway request transformations.
func (s *Server) dispatchChatWallet(ctx context.Context, call CallContext, route RouteSelection, req ChatCompletionRequest) error {
	if call.walletPayer == "" {
		return nil
	}
	if err := s.validatePrepaidChatRoute(call, route, req); err != nil {
		return &ProviderInvocationError{Err: err, Disposition: ProviderErrorTransientSame}
	}
	if err := s.payments.store.dispatchWalletUsage(ctx, call, route, req.requestedMaxTokens()); err != nil {
		if AsHTTPError(err).Code == "prepaid_route_unsupported" {
			return &ProviderInvocationError{Err: err, Disposition: ProviderErrorTransientSame}
		}
		return &ProviderInvocationError{Err: err, Disposition: ProviderErrorClient}
	}
	return nil
}

func (s *Server) validatePrepaidChatRoute(call CallContext, route RouteSelection, req ChatCompletionRequest) error {
	adapter, err := s.adapterForRoute(route)
	if err != nil {
		return err
	}
	switch adapter.(type) {
	case OpenAICompatibleAdapter, *OpenAICompatibleAdapter, AzureOpenAIAdapter, *AzureOpenAIAdapter, MockAdapter, *MockAdapter:
	default:
		return walletUsageError()
	}
	_, chatBridge := s.chatRouteBridge(route)
	_, streamBridge := s.streamChatRouteBridge(route)
	if chatBridge || streamBridge || routeSupportsProviderProtocol(s.adapterRegistry, route, providerRouteProtocolCodexResponses) ||
		len(s.gatewayProviderCallHooksForRoute(call, route, providerRouteProtocolChatCompletions, req.Stream)) != 0 ||
		req.Tools != nil || req.ToolChoice != nil {
		return walletUsageError()
	}
	for field := range req.raw {
		switch field {
		case "model", "messages", "stream", "stream_options", "max_tokens", "max_completion_tokens", "temperature", "top_p",
			"presence_penalty", "frequency_penalty", "min_p", "top_k", "stop", "response_format",
			"reasoning_effort", "metadata", "prompt_cache_key", "user":
		default:
			return walletUsageError()
		}
	}
	for _, message := range req.Messages {
		if _, ok := message.Content.(string); !ok || message.ToolCalls != nil || message.ToolCallID != "" {
			return walletUsageError()
		}
		for field := range message.raw {
			switch field {
			case "role", "content", "name", "reasoning_content":
			default:
				return walletUsageError()
			}
		}
	}
	return nil
}

func walletUsageCharge(entry walletUsage, usage Usage) (string, int64) {
	if usage.MeteringInvalid || usage.InputAudioTokens != 0 || usage.OutputAudioTokens != 0 || usage.PromptTokens <= 0 || (entry.SettlementMode != "postpaid" && (usage.PromptTokens > entry.InputBound || usage.CompletionTokens > entry.OutputBound)) {
		return "pending_review", 0
	}
	units, err := meteringUnits(usage)
	if usage.MeteringRaw != nil {
		units, err = *usage.MeteringRaw, nil
	}
	if err != nil {
		return "pending_review", 0
	}
	var rates metering.Rates
	if json.Unmarshal([]byte(entry.Rates), &rates) != nil {
		return "pending_review", 0
	}
	charge, err := metering.Price(rates, units, "USD", "")
	if err != nil {
		return "pending_review", 0
	}
	amount, err := walletMicros(charge.USD, entry.Rate, false)
	if err != nil || (entry.SettlementMode != "postpaid" && amount > entry.ReservedMicros) {
		return "pending_review", 0
	}
	return "settled", amount
}

type walletUsageReceipt struct {
	Status        string `json:"status"`
	ChargedMicros int64  `json:"charged_micros"`
}

func (s *Server) playgroundWalletReceipt(call CallContext) *walletUsageReceipt {
	if call.walletPayer == "" {
		return nil
	}
	var entry walletUsage
	if err := s.payments.store.db.Select("status", "charged_micros").Take(&entry, "request_id = ? AND user_id = ?", call.RequestID, call.walletPayer).Error; err != nil {
		log.Printf("wallet usage receipt unavailable request_id=%s: %v", call.RequestID, err)
		return &walletUsageReceipt{Status: "pending_review"}
	}
	return &walletUsageReceipt{Status: entry.Status, ChargedMicros: entry.ChargedMicros}
}
