package paymentmock

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"tokenhub/backend/internal/payment"
)

type order struct {
	tradeNo string
	amount  int64
	expires time.Time
	closed  bool
}

type Channel struct {
	mu     sync.Mutex
	orders map[string]order
}

func NewChannel() *Channel {
	return &Channel{orders: make(map[string]order)}
}

func (*Channel) Merchant() string { return "mock-local-wechat" }

func (c *Channel) Prepay(_ context.Context, orderNo, _ string, amount int64, expires time.Time, _ string) (payment.Checkout, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.orders[orderNo]; ok {
		if existing.amount != amount {
			return payment.Checkout{}, errors.New("mock payment order amount mismatch")
		}
		return payment.Checkout{QRCode: "mock://wechat/" + orderNo}, nil
	}
	c.orders[orderNo] = order{tradeNo: "mock-trade-" + orderNo, amount: amount, expires: expires}
	return payment.Checkout{QRCode: "mock://wechat/" + orderNo}, nil
}

func (c *Channel) Query(_ context.Context, orderNo string) (payment.OrderResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item, ok := c.orders[orderNo]
	if !ok {
		return payment.OrderResult{}, payment.ErrOrderNotFound
	}
	if item.closed || !item.expires.After(time.Now()) {
		return payment.OrderResult{OrderNo: orderNo, TradeNo: item.tradeNo, AmountFen: item.amount, Status: payment.Closed}, nil
	}
	return payment.OrderResult{OrderNo: orderNo, TradeNo: item.tradeNo, AmountFen: item.amount, Status: payment.Succeeded}, nil
}

func (c *Channel) Close(_ context.Context, orderNo string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	item, ok := c.orders[orderNo]
	if !ok {
		return payment.ErrOrderNotFound
	}
	item.closed = true
	c.orders[orderNo] = item
	return nil
}

func (*Channel) Notify(*http.Request) (payment.OrderResult, error) {
	return payment.OrderResult{}, errors.New("mock payment notifications are disabled")
}

func (*Channel) Refund(context.Context, string, string, string, int64) error {
	return errors.New("mock payment refunds are unsupported")
}

func (*Channel) QueryRefund(context.Context, string, string) (payment.RefundResult, error) {
	return payment.RefundResult{}, errors.New("mock payment refunds are unsupported")
}
