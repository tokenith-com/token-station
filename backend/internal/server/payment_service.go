package server

import (
	"context"
	"errors"
	"log"
	"time"

	"tokenhub/backend/internal/payment"
)

type paymentService struct {
	config *payment.Service
	store  *GormStore
	cancel context.CancelFunc
	done   chan struct{}
}

func (p *paymentService) channel(order paymentOrder) (payment.Channel, error) {
	channel := p.config.Channels[order.Channel]
	if channel == nil || channel.Merchant() != order.Merchant {
		return nil, NewHTTPError(503, "payment_merchant_unavailable", "The original payment merchant is unavailable")
	}
	return channel, nil
}

func (p *paymentService) prepareOrder(ctx context.Context, order paymentOrder) (paymentOrder, error) {
	if order.Status != payment.Pending || (order.QRCode != "" || order.PayURL != "") || time.Until(time.Unix(order.ExpiresAt, 0)) < time.Minute {
		return order, nil
	}
	channel, err := p.channel(order)
	if err != nil {
		return order, err
	}
	now := time.Now()
	claim := p.store.db.WithContext(ctx).Model(&paymentOrder{}).
		Where("order_no = ? AND status = ? AND qr_code = '' AND pay_url = '' AND prepay_lease_until <= ? AND expires_at > ?", order.OrderNo, payment.Pending, now.Unix(), now.Unix()).
		Update("prepay_lease_until", now.Add(time.Minute).Unix())
	if claim.Error != nil {
		return order, claim.Error
	}
	if claim.RowsAffected == 0 {
		return p.store.paymentOrder(ctx, order.OrderNo, order.UserID)
	}
	if order.PrepayLeaseUntil != 0 {
		if result, queryErr := channel.Query(ctx, order.OrderNo); queryErr == nil && result.Status != payment.Pending {
			if err := p.applyOrderResult(ctx, order, result); err != nil {
				return order, err
			}
			return p.store.paymentOrder(ctx, order.OrderNo, order.UserID)
		}
	}
	checkout, err := channel.Prepay(ctx, order.OrderNo, order.Subject, order.AmountFen, time.Unix(order.ExpiresAt, 0), order.APIMethod)
	if err != nil {
		return order, NewHTTPError(502, "payment_prepay_unconfirmed", "Payment order is saved, but the channel did not confirm the checkout. Retry with the original idempotency key.")
	}
	if (checkout.QRCode == "") == (checkout.PayURL == "") || len(checkout.QRCode) > 4096 || len(checkout.PayURL) > 8192 {
		return order, NewHTTPError(502, "payment_checkout_invalid", "The payment channel returned invalid checkout details")
	}
	err = p.store.db.WithContext(ctx).Model(&paymentOrder{}).Where("order_no = ? AND status = ?", order.OrderNo, payment.Pending).Updates(map[string]any{"qr_code": checkout.QRCode, "pay_url": checkout.PayURL}).Error
	if err != nil {
		return order, err
	}
	return p.store.paymentOrder(ctx, order.OrderNo, order.UserID)
}

func (p *paymentService) applyOrderResult(ctx context.Context, order paymentOrder, result payment.OrderResult) error {
	switch result.Status {
	case payment.Succeeded:
		return p.store.settlePayment(ctx, order, result)
	case payment.Closed:
		if result.OrderNo != order.OrderNo {
			return errors.New("channel order number mismatch")
		}
		return p.store.db.WithContext(ctx).Model(&paymentOrder{}).Where("order_no = ? AND status = ?", order.OrderNo, payment.Pending).
			Updates(map[string]any{"status": payment.Closed, "qr_code": "", "pay_url": ""}).Error
	default:
		return nil
	}
}

func (p *paymentService) reconcileOrder(ctx context.Context, order paymentOrder) error {
	latest, err := p.store.paymentOrder(ctx, order.OrderNo, "")
	if err != nil {
		return err
	}
	order = latest
	if order.Status != payment.Pending {
		return nil
	}
	channel, err := p.channel(order)
	if err != nil {
		return err
	}
	result, err := channel.Query(ctx, order.OrderNo)
	expired := order.ExpiresAt <= time.Now().Unix() && order.PrepayLeaseUntil <= time.Now().Unix()
	if expired && errors.Is(err, payment.ErrOrderNotFound) {
		return p.applyOrderResult(ctx, order, payment.OrderResult{OrderNo: order.OrderNo, Status: payment.Closed})
	}
	if err != nil {
		return err
	}
	if result.Status != payment.Pending || !expired {
		return p.applyOrderResult(ctx, order, result)
	}
	if err := channel.Close(ctx, order.OrderNo); err != nil {
		return err
	}
	return p.applyOrderResult(ctx, order, payment.OrderResult{OrderNo: order.OrderNo, Status: payment.Closed})
}

func (p *paymentService) reconcileRefund(ctx context.Context, order paymentOrder, refund paymentRefund) error {
	if refund.Status != payment.Pending {
		return nil
	}
	channel, err := p.channel(order)
	if err != nil {
		return err
	}
	if refund.SubmittedAt == 0 {
		now := time.Now()
		claim := p.store.db.WithContext(ctx).Model(&paymentRefund{}).
			Where("refund_no = ? AND status = ? AND submitted_at = 0 AND submit_lease_until <= ?", refund.RefundNo, payment.Pending, now.Unix()).
			Update("submit_lease_until", now.Add(5*time.Minute).Unix())
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected == 1 {
			if refund.SubmitLeaseUntil != 0 {
				result, queryErr := channel.QueryRefund(ctx, order.OrderNo, refund.RefundNo)
				if queryErr == nil && (result.Status == payment.Succeeded || result.Status == payment.Failed) {
					return p.store.settlePaymentRefund(ctx, order, refund, result)
				}
			}
			// An ambiguous result stays frozen. Reattempts always use the stored request number.
			if err := channel.Refund(ctx, order.OrderNo, refund.RefundNo, refund.Reason, refund.AmountFen); err != nil {
				return err
			}
			now := time.Now()
			return p.store.db.WithContext(ctx).Model(&paymentRefund{}).
				Where("refund_no = ? AND status = ?", refund.RefundNo, payment.Pending).
				Updates(map[string]any{"submitted_at": now.Unix(), "next_check_at": now.Add(15 * time.Second).Unix()}).Error
		}
	}
	result, err := channel.QueryRefund(ctx, order.OrderNo, refund.RefundNo)
	if err != nil {
		return err
	}
	return p.store.settlePaymentRefund(ctx, order, refund, result)
}

func (p *paymentService) start() {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel, p.done = cancel, make(chan struct{})
	go func() {
		defer close(p.done)
		timer := time.NewTicker(15 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				p.reconcileDue(ctx)
				if err := p.store.reconcileWalletUsage(ctx); err != nil && ctx.Err() == nil {
					log.Print("wallet usage recovery failed")
				}
			}
		}
	}()
}

func (p *paymentService) stop(ctx context.Context) error {
	p.cancel()
	select {
	case <-p.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *paymentService) reconcileDue(ctx context.Context) {
	now := time.Now()
	var orders []paymentOrder
	var refunds []paymentRefund
	db := p.store.db.WithContext(ctx)
	if err := db.Where("status = ? AND next_check_at <= ?", payment.Pending, now.Unix()).Order("next_check_at, order_no").Limit(8).Find(&orders).Error; err != nil {
		log.Print("payment reconciliation could not load orders")
	}
	if err := db.Where("status = ? AND next_check_at <= ?", payment.Pending, now.Unix()).Order("next_check_at, refund_no").Limit(8).Find(&refunds).Error; err != nil {
		log.Print("payment reconciliation could not load refunds")
	}
	for _, refund := range refunds {
		if ctx.Err() != nil {
			return
		}
		claimed := db.Model(&paymentRefund{}).Where("refund_no = ? AND status = ? AND next_check_at = ?", refund.RefundNo, payment.Pending, refund.NextCheckAt).
			Update("next_check_at", time.Now().Add(paymentReconcileInterval).Unix())
		if claimed.Error != nil || claimed.RowsAffected != 1 {
			continue
		}
		order, err := p.store.paymentOrder(ctx, refund.OrderNo, "")
		if err != nil {
			continue
		}
		if err := p.reconcileRefund(ctx, order, refund); err != nil && ctx.Err() == nil {
			log.Printf("payment refund reconciliation pending refund_no=%s", refund.RefundNo)
		}
	}
	for _, order := range orders {
		if ctx.Err() != nil {
			return
		}
		claimed := db.Model(&paymentOrder{}).Where("order_no = ? AND status = ? AND next_check_at = ?", order.OrderNo, payment.Pending, order.NextCheckAt).
			Update("next_check_at", time.Now().Add(paymentReconcileInterval).Unix())
		if claimed.Error != nil || claimed.RowsAffected != 1 {
			continue
		}
		if err := p.reconcileOrder(ctx, order); err != nil && ctx.Err() == nil {
			log.Printf("payment order reconciliation pending order_no=%s", order.OrderNo)
		}
	}
}
