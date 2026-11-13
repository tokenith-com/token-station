package payment

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/smartwalle/alipay/v3"
)

const (
	AlipayNotifyPath = "/api/payments/webhooks/alipay"
	AlipayPrecreate  = "alipay.trade.precreate"
	AlipayPagePay    = "alipay.trade.page.pay"
)

var alipayTimeZone = time.FixedZone("UTC+8", 8*3600)

type alipayConfig struct {
	AppID          string   `yaml:"app_id"`
	SellerID       string   `yaml:"seller_id"`
	PrivateKeyFile string   `yaml:"private_key_file"`
	PublicKeyFile  string   `yaml:"public_key_file"`
	NotifyURL      string   `yaml:"notify_url"`
	Sandbox        bool     `yaml:"sandbox"`
	APIMethods     []string `yaml:"api_methods"`
}

type alipayChannel struct {
	config alipayConfig
	client *alipay.Client
}

func newAlipay(c alipayConfig) (*alipayChannel, error) {
	if c.AppID == "" || c.SellerID == "" || !validCallback(c.NotifyURL, AlipayNotifyPath) {
		return nil, errors.New("app_id, seller_id and an HTTPS payment callback URL are required")
	}
	if len(c.APIMethods) == 0 {
		c.APIMethods = []string{AlipayPrecreate}
	}
	if len(c.APIMethods) > 2 || (len(c.APIMethods) == 2 && c.APIMethods[0] == c.APIMethods[1]) {
		return nil, errors.New("configure up to two distinct alipay API methods")
	}
	for _, method := range c.APIMethods {
		if method != AlipayPrecreate && method != AlipayPagePay {
			return nil, errors.New("unsupported alipay API method")
		}
	}
	private, err := readCredential(c.PrivateKeyFile)
	if err != nil {
		return nil, err
	}
	public, err := readCredential(c.PublicKeyFile)
	if err != nil {
		return nil, err
	}
	client, err := alipay.New(c.AppID, private, !c.Sandbox, alipay.WithHTTPClient(paymentHTTPClient()), alipay.WithTimeLocation(alipayTimeZone))
	if err != nil {
		return nil, errors.New("invalid Alipay application private key")
	}
	if err := client.LoadAliPayPublicKey(public); err != nil {
		return nil, errors.New("invalid Alipay verification public key")
	}
	return &alipayChannel{config: c, client: client}, nil
}

func (a *alipayChannel) Merchant() string {
	environment := "production"
	if a.config.Sandbox {
		environment = "sandbox"
	}
	return a.config.SellerID + ":" + a.config.AppID + ":" + environment
}

func (a *alipayChannel) Prepay(ctx context.Context, order, subject string, fen int64, expires time.Time, method string) (Checkout, error) {
	if !slices.Contains(a.config.APIMethods, method) {
		return Checkout{}, errors.New("alipay API method is disabled")
	}
	trade := alipay.Trade{
		OutTradeNo: order, TotalAmount: yuan(fen), Subject: subject,
		NotifyURL: a.config.NotifyURL, TimeExpire: expires.In(alipayTimeZone).Format("2006-01-02 15:04:05"),
	}
	if method == AlipayPagePay {
		trade.ProductCode = "FAST_INSTANT_TRADE_PAY"
		checkout, err := a.client.TradePagePay(alipay.TradePagePay{Trade: trade})
		if err != nil {
			return Checkout{}, err
		}
		return Checkout{PayURL: checkout.String()}, nil
	}
	trade.ProductCode = "FACE_TO_FACE_PAYMENT"
	res, err := a.client.TradePreCreate(ctx, alipay.TradePreCreate{Trade: trade})
	if err != nil {
		return Checkout{}, err
	}
	if res == nil || res.IsFailure() || res.OutTradeNo != order || res.QRCode == "" {
		return Checkout{}, errors.New("alipay precreate did not return a matching QR code")
	}
	return Checkout{QRCode: res.QRCode}, nil
}

func (a *alipayChannel) Query(ctx context.Context, order string) (OrderResult, error) {
	res, err := a.client.TradeQuery(ctx, alipay.TradeQuery{OutTradeNo: order})
	if err != nil {
		var providerErr *alipay.Error
		if errors.As(err, &providerErr) && providerErr.SubCode == "ACQ.TRADE_NOT_EXIST" {
			return OrderResult{}, ErrOrderNotFound
		}
		return OrderResult{}, err
	}
	if res != nil && res.SubCode == "ACQ.TRADE_NOT_EXIST" {
		return OrderResult{}, ErrOrderNotFound
	}
	if res == nil || res.IsFailure() || res.OutTradeNo != order {
		return OrderResult{}, errors.New("alipay query did not return the requested order")
	}
	if res.TransCurrency != "" && res.TransCurrency != Currency {
		return OrderResult{}, errors.New("alipay currency mismatch")
	}
	return alipayOrderResult(order, res.TradeNo, res.TotalAmount, res.TradeStatus)
}

func alipayOrderResult(order, trade, amount string, status alipay.TradeStatus) (OrderResult, error) {
	result := OrderResult{OrderNo: order, TradeNo: trade, Status: Pending}
	switch status {
	case alipay.TradeStatusSuccess, alipay.TradeStatusFinished:
		fen, err := parseYuan(amount)
		if err != nil {
			return OrderResult{}, err
		}
		result.AmountFen, result.Status = fen, Succeeded
	case alipay.TradeStatusClosed:
		// TRADE_CLOSED can also represent a fully refunded payment.
		result.Status = Closed
	}
	return result, nil
}

func (a *alipayChannel) Close(ctx context.Context, order string) error {
	res, err := a.client.TradeClose(ctx, alipay.TradeClose{OutTradeNo: order})
	if err != nil {
		return err
	}
	if res == nil || res.IsFailure() || res.OutTradeNo != order {
		return errors.New("alipay did not confirm order closure")
	}
	return nil
}

func (a *alipayChannel) Notify(r *http.Request) (OrderResult, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return OrderResult{}, err
	}
	form, err := url.ParseQuery(string(body))
	if err != nil {
		return OrderResult{}, err
	}
	for _, values := range form {
		if len(values) != 1 {
			return OrderResult{}, errors.New("duplicate Alipay notification field")
		}
	}
	if form.Get("sign_type") != "RSA2" || form.Get("alipay_cert_sn") != "" {
		return OrderResult{}, errors.New("unexpected Alipay signature algorithm")
	}
	notification, err := a.client.DecodeNotification(r.Context(), form)
	if err != nil {
		return OrderResult{}, err
	}
	if notification.AppId != a.config.AppID || notification.SellerId != a.config.SellerID {
		return OrderResult{}, errors.New("alipay notification merchant mismatch")
	}
	if currency := form.Get("trans_currency"); currency != "" && currency != Currency {
		return OrderResult{}, errors.New("alipay currency mismatch")
	}
	return alipayOrderResult(notification.OutTradeNo, notification.TradeNo, notification.TotalAmount, notification.TradeStatus)
}

func (a *alipayChannel) Refund(ctx context.Context, order, refund, reason string, fen int64) error {
	res, err := a.client.TradeRefund(ctx, alipay.TradeRefund{OutTradeNo: order, OutRequestNo: refund, RefundAmount: yuan(fen), RefundReason: reason})
	if err != nil {
		return err
	}
	if res == nil || res.IsFailure() || res.OutTradeNo != order {
		return errors.New("alipay refund acceptance unconfirmed")
	}
	return nil
}

func (a *alipayChannel) QueryRefund(ctx context.Context, order, refund string) (RefundResult, error) {
	res, err := a.client.TradeFastPayRefundQuery(ctx, alipay.TradeFastPayRefundQuery{OutTradeNo: order, OutRequestNo: refund})
	if err != nil {
		return RefundResult{}, err
	}
	if res == nil || res.IsFailure() {
		return RefundResult{}, errors.New("alipay refund query unconfirmed")
	}
	result := RefundResult{OrderNo: order, RefundNo: refund, Status: Pending}
	if res.RefundStatus != "REFUND_SUCCESS" {
		return result, nil
	}
	if res.OutTradeNo != order || res.OutRequestNo != refund {
		return RefundResult{}, errors.New("alipay refund identity mismatch")
	}
	fen, err := parseYuan(res.RefundAmount)
	if err != nil {
		return RefundResult{}, err
	}
	total, err := parseYuan(res.TotalAmount)
	if err != nil || total != fen {
		return RefundResult{}, errors.New("alipay full refund amount differs from the original payment")
	}
	result.Status, result.AmountFen, result.TradeNo = Succeeded, fen, res.TradeNo
	return result, nil
}

func yuan(fen int64) string { return fmt.Sprintf("%d.%02d", fen/100, fen%100) }

func parseYuan(value string) (int64, error) {
	units, fraction, _ := strings.Cut(value, ".")
	digits := units + fraction
	if units == "" || len(units) > 12 || len(fraction) > 2 || strings.Trim(digits, "0123456789") != "" {
		return 0, errors.New("invalid decimal payment amount")
	}
	fen, err := strconv.ParseInt(digits+strings.Repeat("0", 2-len(fraction)), 10, 64)
	if err != nil || fen < 1 {
		return 0, errors.New("invalid decimal payment amount")
	}
	return fen, nil
}
