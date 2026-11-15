package payment

import (
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
)

func signTestPayment(t *testing.T, key *rsa.PrivateKey, body string) string {
	t.Helper()
	hash := sha256.Sum256([]byte(body))
	signed, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(signed)
}

func newTestAlipay(t *testing.T, methods ...string) (*alipayChannel, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	privatePath, publicPath := filepath.Join(dir, "private.pem"), filepath.Join(dir, "public.pem")
	private, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	public, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	for path, data := range map[string][]byte{
		privatePath: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}),
		publicPath:  pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public}),
	} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	a, err := newAlipay(alipayConfig{AppID: "test-app", SellerID: "test-seller", PrivateKeyFile: privatePath, PublicKeyFile: publicPath,
		NotifyURL: "https://payments.example.test" + AlipayNotifyPath, Sandbox: true, APIMethods: methods})
	if err != nil {
		t.Fatal(err)
	}
	return a, key
}

func TestPaymentAlipaySignedNotification(t *testing.T) {
	a, key := newTestAlipay(t)
	form := url.Values{
		"app_id": {"test-app"}, "out_trade_no": {"test-order"}, "seller_id": {"test-seller"},
		"total_amount": {"10.05"}, "trade_no": {"test-trade"}, "trade_status": {"TRADE_SUCCESS"}, "sign_type": {"RSA2"},
	}
	form.Set("sign", signTestPayment(t, key, "app_id=test-app&out_trade_no=test-order&seller_id=test-seller&total_amount=10.05&trade_no=test-trade&trade_status=TRADE_SUCCESS"))
	result, err := a.Notify(httptest.NewRequest("POST", AlipayNotifyPath, strings.NewReader(form.Encode())))
	if err != nil || result.AmountFen != 1005 || result.Status != Succeeded {
		t.Fatalf("valid payment notification: %+v, %v", result, err)
	}
	form.Set("total_amount", "10.06")
	if _, err := a.Notify(httptest.NewRequest("POST", AlipayNotifyPath, strings.NewReader(form.Encode()))); err == nil {
		t.Fatal("tampered amount accepted")
	}
	form.Set("seller_id", "different-seller")
	form.Set("sign", signTestPayment(t, key, "app_id=test-app&out_trade_no=test-order&seller_id=different-seller&total_amount=10.06&trade_no=test-trade&trade_status=TRADE_SUCCESS"))
	if _, err := a.Notify(httptest.NewRequest("POST", AlipayNotifyPath, strings.NewReader(form.Encode()))); err == nil {
		t.Fatal("valid notification from another seller accepted")
	}
}

type alipayTestTransport func(*http.Request) (*http.Response, error)

func (f alipayTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPaymentAlipayCheckoutModes(t *testing.T) {
	a, key := newTestAlipay(t, AlipayPagePay, AlipayPrecreate)
	a.config.ReturnURL = "https://app.example.com/maas/balance-recharge/?source=checkout"
	expires := time.Date(2026, time.November, 13, 9, 30, 0, 0, time.UTC)
	checkTrade := func(form url.Values, method, product string) {
		t.Helper()
		if form.Get("method") != method || form.Get("notify_url") != a.config.NotifyURL || form.Get("app_id") != a.config.AppID {
			t.Fatalf("unexpected Alipay request fields: %v", form)
		}
		var trade map[string]string
		if err := json.Unmarshal([]byte(form.Get("biz_content")), &trade); err != nil {
			t.Fatal(err)
		}
		if trade["out_trade_no"] != "TS-test" || trade["total_amount"] != "10.05" ||
			trade["product_code"] != product || trade["time_expire"] != "2026-11-13 17:30:00" {
			t.Fatalf("unexpected Alipay trade: %v", trade)
		}
		parts := make([]string, 0, len(form)-1)
		for field, values := range form {
			if field != "sign" && len(values) == 1 && values[0] != "" {
				parts = append(parts, field+"="+values[0])
			}
		}
		sort.Strings(parts)
		digest := sha256.Sum256([]byte(strings.Join(parts, "&")))
		signature, err := base64.StdEncoding.DecodeString(form.Get("sign"))
		if err != nil {
			t.Fatal(err)
		}
		if err := rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, digest[:], signature); err != nil {
			t.Fatalf("invalid Alipay request signature: %v", err)
		}
	}
	calls := 0
	a.client.Client.Transport = alipayTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		checkTrade(r.Form, AlipayPrecreate, "FACE_TO_FACE_PAYMENT")
		body := `{"code":"10000","out_trade_no":"TS-test","qr_code":"https://qr.alipay.example/test"}`
		response := fmt.Sprintf(`{"alipay_trade_precreate_response":%s,"sign":%q}`, body, signTestPayment(t, key, body))
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(response))}, nil
	})
	page, err := a.Prepay(context.Background(), "TS-test", "Test recharge", 1005, expires, AlipayPagePay)
	if err != nil || page.QRCode != "" || calls != 0 {
		t.Fatalf("page checkout: %+v, %v, requests %d", page, err, calls)
	}
	checkoutURL, err := url.Parse(page.PayURL)
	if err != nil || checkoutURL.Scheme != "https" || checkoutURL.Hostname() == "" {
		t.Fatalf("invalid checkout URL: %s", page.PayURL)
	}
	checkTrade(checkoutURL.Query(), AlipayPagePay, "FAST_INSTANT_TRADE_PAY")
	returnURL, err := url.Parse(checkoutURL.Query().Get("return_url"))
	if err != nil || returnURL.Host != "app.example.com" || returnURL.Path != "/maas/balance-recharge/" || returnURL.Query().Get("payment_order") != "TS-test" || returnURL.Query().Get("source") != "checkout" {
		t.Fatalf("invalid merchant return URL: %v, %v", returnURL, err)
	}
	qr, err := a.Prepay(context.Background(), "TS-test", "Test recharge", 1005, expires, AlipayPrecreate)
	if err != nil || qr.PayURL != "" || qr.QRCode != "https://qr.alipay.example/test" || calls != 1 {
		t.Fatalf("precreate checkout: %+v, %v, requests %d", qr, err, calls)
	}
}

func TestPaymentWechatSignedEncryptedNotification(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	secret := "synthetic-payment-key-0123456789"
	handler, err := notify.NewRSANotifyHandler(secret, verifiers.NewSHA256WithRSAPubkeyVerifier("test-key", key.PublicKey))
	if err != nil {
		t.Fatal(err)
	}
	adapter := WechatChannel{config: wechatConfig{AppID: "test-app", MerchantID: "test-merchant"}, notify: handler}
	block, err := aes.NewCipher([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce, aad := "123456789012", "test-resource"
	plaintext := []byte(`{"appid":"test-app","mchid":"test-merchant","out_trade_no":"test-order","transaction_id":"test-trade","trade_state":"SUCCESS","amount":{"total":1005,"currency":"CNY"}}`)
	payload, err := json.Marshal(map[string]any{"event_type": "TRANSACTION.SUCCESS", "resource": map[string]string{
		"algorithm": "AEAD_AES_256_GCM", "ciphertext": base64.StdEncoding.EncodeToString(gcm.Seal(nil, []byte(nonce), plaintext, []byte(aad))),
		"nonce": nonce, "associated_data": aad,
	}})
	if err != nil {
		t.Fatal(err)
	}
	timestamp := fmt.Sprint(time.Now().Unix())
	signature := signTestPayment(t, key, timestamp+"\n"+nonce+"\n"+string(payload)+"\n")
	r := httptest.NewRequest("POST", WechatNotifyPath, strings.NewReader(string(payload)))
	r.Header.Set("Wechatpay-Timestamp", timestamp)
	r.Header.Set("Wechatpay-Nonce", nonce)
	r.Header.Set("Wechatpay-Serial", "test-key")
	r.Header.Set("Wechatpay-Signature", signature)
	result, err := adapter.Notify(r)
	if err != nil || result.AmountFen != 1005 || result.Status != Succeeded {
		t.Fatalf("valid WeChat notification: %+v, %v", result, err)
	}
	tampered := httptest.NewRequest("POST", WechatNotifyPath, strings.NewReader(string(payload)+" "))
	tampered.Header = r.Header.Clone()
	if _, err := adapter.Notify(tampered); err == nil {
		t.Fatal("tampered notification accepted")
	}
}

func TestPaymentAlipayRejectsUnsafeReturnURLs(t *testing.T) {
	for _, value := range []string{"http://app.example.com/", "//app.example.com/", "https:///page", "https://user:secret@app.example.com/", "https://app.example.com/#token", "javascript:alert(1)"} {
		t.Run(value, func(t *testing.T) {
			_, err := newAlipay(alipayConfig{AppID: "test", SellerID: "test", NotifyURL: "https://api.example.com" + AlipayNotifyPath, ReturnURL: value})
			if err == nil || !strings.Contains(err.Error(), "return_url") {
				t.Fatalf("expected return URL rejection, got %v", err)
			}
		})
	}
}
