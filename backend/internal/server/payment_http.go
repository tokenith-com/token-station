package server

import (
	"errors"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"tokenhub/backend/internal/payment"
)

func (s *Server) paymentRoutes() {
	s.registerSingleMethodRoute("GET", "/api/admin/recharge/plans", s.paymentPlans, jsonMethodNotAllowed("GET"))
	s.registerMethodRoutes("/api/admin/recharge/orders", jsonMethodNotAllowed,
		methodRoute{Method: "GET", Handler: s.listOwnPaymentOrders}, methodRoute{Method: "POST", Handler: s.createPaymentOrder})
	s.registerSingleMethodRoute("GET", "/api/admin/recharge/orders/{order_no}", s.getOwnPaymentOrder, jsonMethodNotAllowed("GET"))
	s.registerSingleMethodRoute("GET", "/api/admin/wallet", s.getPaymentWallet, jsonMethodNotAllowed("GET"))
	s.registerSingleMethodRoute("GET", "/api/admin/wallet/usage", s.listOwnWalletUsage, jsonMethodNotAllowed("GET"))
	s.registerSingleMethodRoute("GET", "/api/admin/payment-wallet/usage", s.listOperatorWalletUsage, jsonMethodNotAllowed("GET"))
	s.registerSingleMethodRoute("POST", "/api/admin/payment-wallet/usage/{request_id}/resolve", s.resolveOperatorWalletUsage, jsonMethodNotAllowed("POST"))
	s.registerSingleMethodRoute("GET", "/api/admin/wallet/transactions", s.listWalletTransactions, jsonMethodNotAllowed("GET"))
	s.registerSingleMethodRoute("GET", "/api/admin/payment-orders", s.listAdminPaymentOrders, jsonMethodNotAllowed("GET"))
	s.registerSingleMethodRoute("POST", "/api/admin/payment-orders/{order_no}/reconcile", s.reconcilePaymentOrder, jsonMethodNotAllowed("POST"))
	s.registerMethodRoutes("/api/admin/payment-orders/{order_no}/refunds", jsonMethodNotAllowed,
		methodRoute{Method: "GET", Handler: s.getPaymentRefund}, methodRoute{Method: "POST", Handler: s.createPaymentRefund})
	s.registerSingleMethodRoute("POST", "/api/admin/payment-refunds/{refund_no}/reconcile", s.reconcilePaymentRefund, jsonMethodNotAllowed("POST"))
	s.registerSingleMethodRoute("POST", payment.WechatNotifyPath, s.paymentWebhook(payment.Wechat), jsonMethodNotAllowed("POST"))
	s.registerSingleMethodRoute("POST", payment.AlipayNotifyPath, s.paymentWebhook(payment.Alipay), jsonMethodNotAllowed("POST"))
	s.registerSingleMethodRoute("POST", payment.WechatRefundNotifyPath, s.wechatRefundWebhook, jsonMethodNotAllowed("POST"))
}

func (s *Server) paymentUser(w http.ResponseWriter, r *http.Request, operator bool) (AdminUser, bool) {
	if s.payments == nil {
		writeError(w, r, NewHTTPError(503, "payments_disabled", "Payments are disabled"))
		return AdminUser{}, false
	}
	// Payment actions require an attributable user session. The bootstrap
	// administrator token can resolve to an unrelated account.
	token := bearerToken(r)
	if token == "" || token == strings.TrimSpace(s.config.AdminToken) {
		writeError(w, r, NewHTTPError(401, "invalid_session", "A user login session is required"))
		return AdminUser{}, false
	}
	user, ok := s.store.ValidateAdminSession(token)
	if !ok {
		writeError(w, r, NewHTTPError(401, "invalid_session", "A user login session is required"))
		return AdminUser{}, false
	}
	role := normalizeAdminRole(user.Role)
	allowed := role == "consumer"
	if operator {
		allowed = role == "admin" || role == "system_admin"
	}
	if !allowed {
		writeError(w, r, NewHTTPError(403, "payment_forbidden", "This role cannot perform the payment action"))
		return AdminUser{}, false
	}
	return user, true
}

func paymentWriteError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = NewHTTPError(404, "payment_not_found", "Payment order or refund not found")
	} else if AsHTTPError(err).Status >= 500 && AsHTTPError(err).Code == "internal_error" {
		log.Printf("payment persistence failed method=%s", r.Method)
		err = NewHTTPError(500, "payment_internal_error", "Could not complete the payment operation")
	}
	writeError(w, r, err)
}

func (s *Server) paymentPlans(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.paymentUser(w, r, false); !ok {
		return
	}
	channels := make([]string, 0, 2)
	for _, key := range []string{payment.Wechat, payment.Alipay} {
		if s.payments.config.Channels[key] != nil {
			channels = append(channels, key)
		}
	}
	writeJSON(w, 200, map[string]any{"data": s.payments.config.Plans, "channels": channels, "alipay_api_methods": s.payments.config.AlipayMethods, "currency": payment.Currency})
}

func (s *Server) createPaymentOrder(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user, ok := s.paymentUser(w, r, false)
	if !ok {
		return
	}
	var request struct {
		PlanID    string `json:"plan_id"`
		Channel   string `json:"channel"`
		APIMethod string `json:"api_method"`
	}
	if err := s.decodeJSON(w, r, &request); err != nil {
		writeError(w, r, err)
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 128 {
		writeError(w, r, NewHTTPError(400, "invalid_idempotency_key", "Idempotency-Key is required and must be at most 128 bytes"))
		return
	}
	p, ctx := s.payments, r.Context()
	order, err := p.store.paymentOrderByKey(ctx, user.ID, key)
	status := http.StatusOK
	if errors.Is(err, gorm.ErrRecordNotFound) {
		var plan payment.Plan
		for _, item := range p.config.Plans {
			if item.ID == request.PlanID {
				plan = item
				break
			}
		}
		channel := p.config.Channels[request.Channel]
		if plan.ID == "" || channel == nil {
			writeError(w, r, NewHTTPError(400, "invalid_recharge_selection", "Choose an available recharge plan and payment channel"))
			return
		}
		method := request.APIMethod
		if request.Channel == payment.Alipay && method == "" && len(p.config.AlipayMethods) > 0 {
			method = p.config.AlipayMethods[0]
		}
		if (request.Channel == payment.Alipay && !slices.Contains(p.config.AlipayMethods, method)) ||
			(request.Channel != payment.Alipay && method != "") {
			writeError(w, r, NewHTTPError(400, "invalid_payment_api_method", "Choose an enabled Alipay API method"))
			return
		}
		now := time.Now()
		candidate := paymentOrder{OrderNo: "TS" + strings.ReplaceAll(uuid.NewString(), "-", "")[:30],
			UserID: user.ID, PlanID: plan.ID, Subject: plan.Name, Channel: request.Channel, APIMethod: method, Merchant: channel.Merchant(),
			AmountFen: plan.AmountFen, Currency: payment.Currency, Status: payment.Pending, IdempotencyKey: key,
			CreatedAt: now.Unix(), ExpiresAt: now.Add(15 * time.Minute).Unix(), NextCheckAt: now.Add(paymentReconcileInterval).Unix()}
		order, err = p.store.savePaymentOrder(ctx, candidate)
		if order.OrderNo == candidate.OrderNo {
			status = http.StatusCreated
		}
	}
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	if order.PlanID != request.PlanID || order.Channel != request.Channel || (request.APIMethod != "" && order.APIMethod != request.APIMethod) {
		writeError(w, r, NewHTTPError(409, "idempotency_conflict", "This idempotency key belongs to a different recharge request"))
		return
	}
	order, err = p.prepareOrder(ctx, order)
	if err != nil {
		if AsHTTPError(err).Code == "payment_prepay_unconfirmed" {
			writeJSON(w, http.StatusAccepted, order)
			return
		}
		paymentWriteError(w, r, err)
		return
	}
	if order.ExpiresAt <= time.Now().Unix() {
		order.QRCode, order.PayURL = "", ""
	}
	if order.Status == payment.Pending && order.QRCode == "" && order.PayURL == "" {
		status = http.StatusAccepted
	}
	writeJSON(w, status, order)
}

func paymentPage(r *http.Request) (int, int) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 50
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	return limit, max(offset, 0)
}

func (s *Server) listOwnPaymentOrders(w http.ResponseWriter, r *http.Request) {
	user, ok := s.paymentUser(w, r, false)
	if ok {
		s.listPaymentOrders(w, r, user.ID)
	}
}

func (s *Server) listAdminPaymentOrders(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.paymentUser(w, r, true); ok {
		s.listPaymentOrders(w, r, "")
	}
}

func (s *Server) listPaymentOrders(w http.ResponseWriter, r *http.Request, userID string) {
	limit, offset := paymentPage(r)
	orders := make([]paymentOrder, 0)
	query := s.payments.store.db.WithContext(r.Context()).Omit("qr_code", "pay_url")
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if err := query.Order("created_at DESC, order_no DESC").Limit(limit).Offset(offset).Find(&orders).Error; err != nil {
		paymentWriteError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"data": orders, "limit": limit, "offset": offset})
}

func (s *Server) getOwnPaymentOrder(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user, ok := s.paymentUser(w, r, false)
	if !ok {
		return
	}
	order, err := s.payments.store.paymentOrder(r.Context(), r.PathValue("order_no"), user.ID)
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	if order.ExpiresAt <= time.Now().Unix() {
		order.QRCode, order.PayURL = "", ""
	}
	writeJSON(w, 200, order)
}

func (s *Server) getPaymentWallet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user, ok := s.paymentUser(w, r, false)
	if !ok {
		return
	}
	wallet := userWallet{UserID: user.ID, Currency: payment.Currency}
	err := s.payments.store.db.WithContext(r.Context()).Where("user_id = ? AND currency = ?", user.ID, payment.Currency).Take(&wallet).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		paymentWriteError(w, r, err)
		return
	}
	writeJSON(w, 200, struct {
		userWallet
		AvailableFen    int64 `json:"available_fen"`
		AvailableMicros int64 `json:"available_micros"`
		PrepaidUsage    bool  `json:"prepaid_usage"`
	}{wallet, wallet.availableMicros() / walletMicrosPerFen, wallet.availableMicros(), s.payments.config.PrepaidUsage})
}

func (s *Server) listWalletTransactions(w http.ResponseWriter, r *http.Request) {
	user, ok := s.paymentUser(w, r, false)
	if !ok {
		return
	}
	limit, offset := paymentPage(r)
	transactions := make([]walletTransaction, 0)
	err := s.payments.store.db.WithContext(r.Context()).Where("user_id = ?", user.ID).
		Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&transactions).Error
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"data": transactions, "limit": limit, "offset": offset})
}

func (s *Server) reconcilePaymentOrder(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.paymentUser(w, r, true); !ok {
		return
	}
	p, ctx := s.payments, r.Context()
	order, err := p.store.paymentOrder(ctx, r.PathValue("order_no"), "")
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	if err := p.reconcileOrder(ctx, order); err != nil {
		writeError(w, r, NewHTTPError(502, "payment_query_unconfirmed", "The payment channel did not confirm the order status"))
		return
	}
	order, err = p.store.paymentOrder(ctx, order.OrderNo, "")
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	order.QRCode, order.PayURL = "", ""
	writeJSON(w, 200, order)
}

func (s *Server) createPaymentRefund(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.paymentUser(w, r, true)
	if !ok {
		return
	}
	var request struct {
		Reason string `json:"reason"`
	}
	if err := s.decodeJSON(w, r, &request); err != nil {
		writeError(w, r, err)
		return
	}
	reason := strings.TrimSpace(request.Reason)
	if reason == "" || len(reason) > 80 {
		writeError(w, r, NewHTTPError(400, "invalid_refund_reason", "A refund reason of up to 80 bytes is required"))
		return
	}
	p, ctx := s.payments, r.Context()
	order, err := p.store.paymentOrder(ctx, r.PathValue("order_no"), "")
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	if _, err := p.channel(order); err != nil {
		paymentWriteError(w, r, err)
		return
	}
	refund, err := p.store.reservePaymentRefund(ctx, order, actor.ID, reason)
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	s.recordAdminAudit(r, actor, "request_payment_refund", "payment_refund", refund.RefundNo, nil, refund)
	if err := p.reconcileRefund(ctx, order, refund); err != nil {
		log.Printf("payment refund result pending refund_no=%s", refund.RefundNo)
	}
	refund, err = p.store.paymentRefund(ctx, "refund_no", refund.RefundNo)
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	status := http.StatusOK
	if refund.Status == payment.Pending {
		status = http.StatusAccepted
	}
	writeJSON(w, status, refund)
}

func (s *Server) getPaymentRefund(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.paymentUser(w, r, true); !ok {
		return
	}
	refund, err := s.payments.store.paymentRefund(r.Context(), "order_no", r.PathValue("order_no"))
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	writeJSON(w, 200, refund)
}

func (s *Server) reconcilePaymentRefund(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.paymentUser(w, r, true)
	if !ok {
		return
	}
	p, ctx := s.payments, r.Context()
	refund, err := p.store.paymentRefund(ctx, "refund_no", r.PathValue("refund_no"))
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	order, err := p.store.paymentOrder(ctx, refund.OrderNo, "")
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	if err := p.reconcileRefund(ctx, order, refund); err != nil {
		writeError(w, r, NewHTTPError(502, "refund_query_unconfirmed", "The refund remains pending until the channel confirms its result"))
		return
	}
	updated, err := p.store.paymentRefund(ctx, "refund_no", refund.RefundNo)
	if err != nil {
		paymentWriteError(w, r, err)
		return
	}
	s.recordAdminAudit(r, actor, "reconcile_payment_refund", "payment_refund", refund.RefundNo, refund, updated)
	writeJSON(w, 200, updated)
}
