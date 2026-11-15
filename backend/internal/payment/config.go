// Package payment implements TokenStation's direct merchant integrations.
package payment

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	Wechat    = "wechat"
	Alipay    = "alipay"
	Currency  = "CNY"
	Pending   = "pending"
	Succeeded = "succeeded"
	Closed    = "closed"
	Failed    = "failed"
)

var ErrOrderNotFound = errors.New("payment order not found at channel")

type Plan struct {
	Disabled  bool   `yaml:"disabled" json:"disabled"`
	ID        string `yaml:"id" json:"id"`
	Name      string `yaml:"name" json:"name"`
	AmountFen int64  `yaml:"amount_fen" json:"amount_fen"`
}

type OrderResult struct {
	OrderNo   string
	TradeNo   string
	AmountFen int64
	Status    string
}

type RefundResult struct {
	OrderNo          string
	RefundNo         string
	TradeNo          string
	ProviderRefundNo string
	AmountFen        int64
	Status           string
}

type Checkout struct {
	QRCode string
	PayURL string
}

type Channel interface {
	Merchant() string
	Prepay(ctx context.Context, order, subject string, fen int64, expires time.Time, method string) (Checkout, error)
	Query(context.Context, string) (OrderResult, error)
	Close(context.Context, string) error
	Notify(*http.Request) (OrderResult, error)
	Refund(context.Context, string, string, string, int64) error
	QueryRefund(context.Context, string, string) (RefundResult, error)
}

type Service struct {
	PrepaidUsage  bool
	Plans         []Plan
	Channels      map[string]Channel
	AlipayMethods []string
}

type fileConfig struct {
	PrepaidUsage bool          `yaml:"prepaid_usage"`
	Plans        []Plan        `yaml:"plans"`
	Wechat       *wechatConfig `yaml:"wechat"`
	Alipay       *alipayConfig `yaml:"alipay"`
}

func Load(path string) (*Service, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	decoder := yaml.NewDecoder(io.LimitReader(file, 1<<20))
	decoder.KnownFields(true)
	var config fileConfig
	if err := decoder.Decode(&config); err != nil {
		return nil, errors.New("invalid payment YAML or unknown configuration field")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, errors.New("payment YAML must contain one document")
	}
	if len(config.Plans) == 0 || len(config.Plans) > 100 {
		return nil, errors.New("configure 1 to 100 payment plans")
	}
	seen := make(map[string]bool)
	for _, plan := range config.Plans {
		if plan.ID == "" || len(plan.ID) > 64 || strings.TrimSpace(plan.ID) != plan.ID ||
			strings.TrimSpace(plan.Name) == "" || len([]rune(plan.Name)) > 40 ||
			plan.AmountFen < 1 || plan.AmountFen > 100000000 || seen[plan.ID] {
			return nil, errors.New("invalid or duplicate payment plan")
		}
		seen[plan.ID] = true
	}
	service := &Service{PrepaidUsage: config.PrepaidUsage, Plans: config.Plans, Channels: make(map[string]Channel)}
	credentialPath := func(value string) string {
		if value == "" || filepath.IsAbs(value) {
			return value
		}
		return filepath.Join(filepath.Dir(path), value)
	}
	if config.Wechat != nil {
		config.Wechat.CertificateFile = credentialPath(config.Wechat.CertificateFile)
		config.Wechat.PrivateKeyFile = credentialPath(config.Wechat.PrivateKeyFile)
		config.Wechat.PublicKeyFile = credentialPath(config.Wechat.PublicKeyFile)
		config.Wechat.APIv3KeyFile = credentialPath(config.Wechat.APIv3KeyFile)
		channel, err := newWechat(*config.Wechat)
		if err != nil {
			return nil, fmt.Errorf("wechat payment configuration: %w", err)
		}
		service.Channels[Wechat] = channel
	}
	if config.Alipay != nil {
		config.Alipay.PrivateKeyFile = credentialPath(config.Alipay.PrivateKeyFile)
		config.Alipay.PublicKeyFile = credentialPath(config.Alipay.PublicKeyFile)
		channel, err := newAlipay(*config.Alipay)
		if err != nil {
			return nil, fmt.Errorf("alipay payment configuration: %w", err)
		}
		service.Channels[Alipay] = channel
		service.AlipayMethods = channel.config.APIMethods
	}
	if len(service.Channels) == 0 {
		return nil, errors.New("configure at least one payment channel")
	}
	return service, nil
}

func validCallback(value, path string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil &&
		parsed.Path == path && parsed.RawQuery == "" && parsed.Fragment == ""
}

func readCredential(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", errors.New("cannot open payment credential file")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil || len(data) > 65536 || strings.TrimSpace(string(data)) == "" {
		return "", errors.New("invalid payment credential file")
	}
	return strings.TrimSpace(string(data)), nil
}

func paymentHTTPClient() *http.Client {
	return &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
