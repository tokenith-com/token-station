package server

import (
	"errors"
	"io"
	"net/http"

	"tokenhub/backend/internal/payment"
)

func (s *Server) paymentWebhook(key string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := s.payments
		if p == nil || p.config.Channels[key] == nil {
			paymentWebhookResponse(w, key, http.StatusServiceUnavailable)
			return
		}
		channel := p.config.Channels[key]
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		result, err := channel.Notify(r)
		if err != nil {
			paymentWebhookResponse(w, key, http.StatusBadRequest)
			return
		}
		if result.Status != payment.Succeeded && result.Status != payment.Closed {
			paymentWebhookResponse(w, key, http.StatusOK)
			return
		}
		order, err := p.store.paymentOrder(r.Context(), result.OrderNo, "")
		if err != nil || order.Channel != key || order.Merchant != channel.Merchant() {
			paymentWebhookResponse(w, key, http.StatusConflict)
			return
		}
		if err := p.applyOrderResult(r.Context(), order, result); err != nil {
			paymentWebhookResponse(w, key, http.StatusInternalServerError)
			return
		}
		paymentWebhookResponse(w, key, http.StatusOK)
	}
}

func (s *Server) wechatRefundWebhook(w http.ResponseWriter, r *http.Request) {
	p := s.payments
	if p == nil {
		paymentWebhookResponse(w, payment.Wechat, http.StatusServiceUnavailable)
		return
	}
	channel, ok := p.config.Channels[payment.Wechat].(interface {
		RefundNotify(*http.Request) (payment.RefundResult, error)
	})
	if !ok {
		paymentWebhookResponse(w, payment.Wechat, http.StatusServiceUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	result, err := channel.RefundNotify(r)
	if err != nil {
		paymentWebhookResponse(w, payment.Wechat, http.StatusBadRequest)
		return
	}
	if result.Status == payment.Pending {
		paymentWebhookResponse(w, payment.Wechat, http.StatusOK)
		return
	}
	if err := p.applyWechatRefundNotification(r, result); err != nil {
		paymentWebhookResponse(w, payment.Wechat, http.StatusInternalServerError)
		return
	}
	paymentWebhookResponse(w, payment.Wechat, http.StatusOK)
}

func (p *paymentService) applyWechatRefundNotification(r *http.Request, result payment.RefundResult) error {
	ctx := r.Context()
	refund, err := p.store.paymentRefund(ctx, "refund_no", result.RefundNo)
	if err != nil {
		return err
	}
	order, err := p.store.paymentOrder(ctx, refund.OrderNo, "")
	if err != nil {
		return err
	}
	if order.Channel != payment.Wechat {
		return errors.New("refund channel mismatch")
	}
	if _, err := p.channel(order); err != nil {
		return err
	}
	return p.store.settlePaymentRefund(ctx, order, refund, result)
}

func paymentWebhookResponse(w http.ResponseWriter, key string, status int) {
	if key == payment.Alipay {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(status)
		if status == http.StatusOK {
			_, _ = io.WriteString(w, "success")
			return
		}
		_, _ = io.WriteString(w, "failure")
		return
	}
	if status == http.StatusOK {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, status, map[string]string{"code": "FAIL", "message": "Payment notification was not applied"})
}
