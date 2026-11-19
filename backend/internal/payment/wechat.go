package payment

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/services/refunddomestic"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

const WechatNotifyPath = "/api/payments/webhooks/wechat"
const WechatRefundNotifyPath = "/api/payments/webhooks/wechat/refunds"

type wechatConfig struct {
	AppID           string `yaml:"app_id"`
	MerchantID      string `yaml:"merchant_id"`
	CertificateFile string `yaml:"certificate_file"`
	PrivateKeyFile  string `yaml:"private_key_file"`
	PublicKeyID     string `yaml:"public_key_id"`
	PublicKeyFile   string `yaml:"public_key_file"`
	APIv3KeyFile    string `yaml:"api_v3_key_file"`
	NotifyURL       string `yaml:"notify_url"`
	RefundNotifyURL string `yaml:"refund_notify_url"`
}

type WechatChannel struct {
	config  wechatConfig
	native  native.NativeApiService
	refunds refunddomestic.RefundsApiService
	notify  *notify.Handler
}

func newWechat(c wechatConfig) (*WechatChannel, error) {
	if c.AppID == "" || c.MerchantID == "" || c.PublicKeyID == "" ||
		!validCallback(c.NotifyURL, WechatNotifyPath) || !validCallback(c.RefundNotifyURL, WechatRefundNotifyPath) {
		return nil, errors.New("app_id, merchant_id, public_key_id and HTTPS payment/refund callback URLs are required")
	}
	certPEM, err := readCredential(c.CertificateFile)
	if err != nil {
		return nil, fmt.Errorf("merchant certificate: %w", err)
	}
	cert, err := utils.LoadCertificate(certPEM)
	if err != nil || time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
		return nil, errors.New("invalid or expired merchant certificate")
	}
	privatePEM, err := readCredential(c.PrivateKeyFile)
	if err != nil {
		return nil, err
	}
	privateKey, err := utils.LoadPrivateKey(privatePEM)
	if err != nil || !privateKey.PublicKey.Equal(cert.PublicKey) {
		return nil, errors.New("merchant private key does not match certificate")
	}
	publicPEM, err := readCredential(c.PublicKeyFile)
	if err != nil {
		return nil, err
	}
	publicKey, err := utils.LoadPublicKey(publicPEM)
	if err != nil {
		return nil, errors.New("invalid WeChat Pay verification public key")
	}
	apiKey, err := readCredential(c.APIv3KeyFile)
	if err != nil || len(apiKey) != 32 {
		return nil, errors.New("API v3 key file must contain 32 bytes")
	}
	verifier := verifiers.NewSHA256WithRSAPubkeyVerifier(c.PublicKeyID, *publicKey)
	client, err := core.NewClient(context.Background(),
		option.WithMerchantCredential(c.MerchantID, strings.ToUpper(cert.SerialNumber.Text(16)), privateKey),
		option.WithVerifier(verifier), option.WithHTTPClient(paymentHTTPClient()))
	if err != nil {
		return nil, errors.New("cannot initialize WeChat Pay client")
	}
	handler, err := notify.NewRSANotifyHandler(apiKey, verifier)
	if err != nil {
		return nil, errors.New("cannot initialize WeChat Pay notification verifier")
	}
	return &WechatChannel{config: c, native: native.NativeApiService{Client: client}, refunds: refunddomestic.RefundsApiService{Client: client}, notify: handler}, nil
}

func (w *WechatChannel) Merchant() string { return w.config.MerchantID + ":" + w.config.AppID }

func (w *WechatChannel) Prepay(ctx context.Context, order, subject string, fen int64, expires time.Time, _ string) (Checkout, error) {
	res, _, err := w.native.Prepay(ctx, native.PrepayRequest{
		Appid: core.String(w.config.AppID), Mchid: core.String(w.config.MerchantID), Description: core.String(subject),
		OutTradeNo: core.String(order), NotifyUrl: core.String(w.config.NotifyURL), TimeExpire: &expires,
		Amount: &native.Amount{Total: core.Int64(fen), Currency: core.String(Currency)},
	})
	if err != nil {
		return Checkout{}, err
	}
	if res == nil || stringValue(res.CodeUrl) == "" {
		return Checkout{}, errors.New("missing WeChat Pay QR code")
	}
	return Checkout{QRCode: *res.CodeUrl}, nil
}

func (w *WechatChannel) Query(ctx context.Context, order string) (OrderResult, error) {
	res, _, err := w.native.QueryOrderByOutTradeNo(ctx, native.QueryOrderByOutTradeNoRequest{OutTradeNo: core.String(order), Mchid: core.String(w.config.MerchantID)})
	if err != nil {
		var apiErr *core.APIError
		if errors.As(err, &apiErr) && apiErr.Code == "ORDER_NOT_EXIST" {
			return OrderResult{}, ErrOrderNotFound
		}
		return OrderResult{}, err
	}
	if res == nil || stringValue(res.OutTradeNo) != order {
		return OrderResult{}, errors.New("WeChat Pay order mismatch")
	}
	return w.transaction(res)
}

func (w *WechatChannel) transaction(res *payments.Transaction) (OrderResult, error) {
	if stringValue(res.Appid) != w.config.AppID || stringValue(res.Mchid) != w.config.MerchantID {
		return OrderResult{}, errors.New("WeChat Pay merchant mismatch")
	}
	result := OrderResult{OrderNo: stringValue(res.OutTradeNo), TradeNo: stringValue(res.TransactionId), Status: Pending}
	switch stringValue(res.TradeState) {
	case "SUCCESS":
		if res.Amount == nil || res.Amount.Total == nil || stringValue(res.Amount.Currency) != Currency {
			return OrderResult{}, errors.New("invalid WeChat Pay amount or currency")
		}
		result.Status, result.AmountFen = Succeeded, *res.Amount.Total
	case "CLOSED", "REVOKED", "PAYERROR":
		result.Status = Closed
	}
	return result, nil
}

func (w *WechatChannel) Close(ctx context.Context, order string) error {
	_, err := w.native.CloseOrder(ctx, native.CloseOrderRequest{OutTradeNo: core.String(order), Mchid: core.String(w.config.MerchantID)})
	return err
}

func (w *WechatChannel) Notify(r *http.Request) (OrderResult, error) {
	var transaction payments.Transaction
	event, err := w.notify.ParseNotifyRequest(r.Context(), r, &transaction)
	if err != nil {
		return OrderResult{}, err
	}
	if event.EventType != "TRANSACTION.SUCCESS" {
		return OrderResult{}, nil
	}
	return w.transaction(&transaction)
}

func (w *WechatChannel) Refund(ctx context.Context, order, refund, reason string, fen int64) error {
	_, _, err := w.refunds.Create(ctx, refunddomestic.CreateRequest{
		OutTradeNo: core.String(order), OutRefundNo: core.String(refund), Reason: core.String(reason), NotifyUrl: core.String(w.config.RefundNotifyURL),
		Amount: &refunddomestic.AmountReq{Refund: core.Int64(fen), Total: core.Int64(fen), Currency: core.String(Currency)},
	})
	return err
}

func (w *WechatChannel) QueryRefund(ctx context.Context, order, refund string) (RefundResult, error) {
	res, _, err := w.refunds.QueryByOutRefundNo(ctx, refunddomestic.QueryByOutRefundNoRequest{OutRefundNo: core.String(refund)})
	if err != nil {
		return RefundResult{}, err
	}
	if res == nil || stringValue(res.OutTradeNo) != order || stringValue(res.OutRefundNo) != refund {
		return RefundResult{}, errors.New("WeChat Pay refund mismatch")
	}
	result := RefundResult{OrderNo: order, RefundNo: refund, TradeNo: stringValue(res.TransactionId), ProviderRefundNo: stringValue(res.RefundId), Status: Pending}
	if res.Status == nil {
		return result, nil
	}
	switch *res.Status {
	case refunddomestic.STATUS_SUCCESS:
		if res.Amount == nil || res.Amount.Refund == nil || res.Amount.Total == nil || *res.Amount.Refund != *res.Amount.Total || stringValue(res.Amount.Currency) != Currency {
			return RefundResult{}, errors.New("invalid WeChat Pay refund amount or currency")
		}
		result.Status, result.AmountFen = Succeeded, *res.Amount.Refund
	case refunddomestic.STATUS_CLOSED:
		result.Status = Failed
	}
	return result, nil
}

func (w *WechatChannel) RefundNotify(r *http.Request) (RefundResult, error) {
	var resource struct {
		MerchantID string `json:"mchid"`
		OrderNo    string `json:"out_trade_no"`
		RefundNo   string `json:"out_refund_no"`
		TradeNo    string `json:"transaction_id"`
		RefundID   string `json:"refund_id"`
		Status     string `json:"refund_status"`
		Amount     struct {
			Refund int64 `json:"refund"`
			Total  int64 `json:"total"`
		} `json:"amount"`
	}
	event, err := w.notify.ParseNotifyRequest(r.Context(), r, &resource)
	if err != nil {
		return RefundResult{}, err
	}
	if resource.MerchantID != w.config.MerchantID {
		return RefundResult{}, errors.New("WeChat Pay refund merchant mismatch")
	}
	result := RefundResult{OrderNo: resource.OrderNo, RefundNo: resource.RefundNo, TradeNo: resource.TradeNo, ProviderRefundNo: resource.RefundID, AmountFen: resource.Amount.Refund, Status: Pending}
	if event.EventType == "REFUND.SUCCESS" && resource.Status == "SUCCESS" {
		if resource.Amount.Refund <= 0 || resource.Amount.Refund != resource.Amount.Total {
			return RefundResult{}, errors.New("invalid WeChat Pay full refund amount")
		}
		result.Status = Succeeded
	}
	if event.EventType == "REFUND.CLOSED" && resource.Status == "CLOSED" {
		result.Status = Failed
	}
	return result, nil
}

func stringValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
