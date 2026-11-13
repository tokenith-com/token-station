package server

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

func newConsumerRegistrationTestServer(t *testing.T) (*GormStore, *Server, <-chan string) {
	t.Helper()
	store := NewMemoryStore()
	messages := configureTestSMTPChannel(t, store)
	server := NewWithConfig(store, Config{CORSAllowedOrigins: []string{"https://portal.tokenhub.example"}})
	t.Cleanup(func() { _ = server.Shutdown(t.Context()) })
	return store, server, messages
}

func consumerRegistrationRequest(t *testing.T, server *Server, method, path string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	var body *strings.Reader
	if payload == nil {
		body = strings.NewReader("")
	} else {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = strings.NewReader(string(raw))
	}
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("content-type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

// registerWithEmail solves a fresh CAPTCHA and submits an activation request for
// the given email, mirroring how the registration form supplies both fields.
func registerWithEmail(t *testing.T, server *Server, email string) *httptest.ResponseRecorder {
	t.Helper()
	captcha := consumerRegistrationRequest(t, server, http.MethodGet, "/api/admin/auth/register/captcha", nil)
	if captcha.Code != http.StatusOK {
		t.Fatalf("captcha status = %d body=%s", captcha.Code, captcha.Body.String())
	}
	var challenge struct {
		CaptchaID string `json:"captcha_id"`
	}
	if err := json.Unmarshal(captcha.Body.Bytes(), &challenge); err != nil {
		t.Fatal(err)
	}
	server.consumerCaptchaMu.Lock()
	code := server.consumerCaptcha[challenge.CaptchaID].code
	server.consumerCaptchaMu.Unlock()
	return consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/register/activation", map[string]any{
		"email": email, "captcha_id": challenge.CaptchaID, "captcha_answer": code,
	})
}

var activationTokenPattern = regexp.MustCompile(`activation_token=([0-9a-f]{64})`)

func receiveActivationToken(t *testing.T, messages <-chan string) (string, string) {
	t.Helper()
	select {
	case raw := <-messages:
		message := raw + decodeActivationParts(t, raw)
		match := activationTokenPattern.FindStringSubmatch(message)
		if match == nil {
			t.Fatalf("activation email has no token link: %s", message)
		}
		return match[1], message
	case <-time.After(5 * time.Second):
		t.Fatal("activation email was not delivered")
	}
	return "", ""
}

// decodeActivationParts returns the decoded bodies of every MIME part so tests
// can assert on content regardless of the transfer encoding.
func decodeActivationParts(t *testing.T, raw string) string {
	t.Helper()
	parsed, err := mail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatalf("parse activation email: %v", err)
	}
	if parsed.Header.Get("Date") == "" || parsed.Header.Get("Message-ID") == "" {
		t.Fatalf("activation email lacks Date or Message-ID header: %s", raw)
	}
	_, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("parse activation content type: %v", err)
	}
	reader := multipart.NewReader(parsed.Body, params["boundary"])
	var decoded strings.Builder
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("read activation part: %v", err)
		}
		body, err := io.ReadAll(part)
		if err != nil {
			t.Fatalf("read activation part body: %v", err)
		}
		if strings.EqualFold(part.Header.Get("Content-Transfer-Encoding"), "base64") {
			body, err = base64.StdEncoding.DecodeString(strings.NewReplacer("\r", "", "\n", "").Replace(string(body)))
			if err != nil {
				t.Fatalf("decode activation part: %v", err)
			}
		}
		decoded.WriteString("\n")
		decoded.Write(body)
	}
	return decoded.String()
}

func errorCode(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &payload)
	return payload.Error.Code
}

func TestConsumerRegistrationActivationFlowCreatesGuestUser(t *testing.T) {
	store, server, messages := newConsumerRegistrationTestServer(t)

	response := registerWithEmail(t, server, " New.User@Example.com ")
	if response.Code != http.StatusOK {
		t.Fatalf("register status = %d body=%s", response.Code, response.Body.String())
	}
	token, message := receiveActivationToken(t, messages)
	if !strings.Contains(message, "https://portal.tokenhub.example/#activation_token=") {
		t.Fatalf("activation link does not target the portal fragment: %s", message)
	}
	if !strings.Contains(message, "Subject: =?UTF-8?b?") {
		t.Fatalf("activation subject is not MIME encoded: %s", message)
	}
	if !strings.Contains(message, "multipart/alternative") || !strings.Contains(message, "Content-Type: text/html; charset=UTF-8") {
		t.Fatalf("activation email lacks an HTML alternative: %s", message)
	}

	verify := consumerRegistrationRequest(t, server, http.MethodGet, "/api/admin/auth/activation/verify?token="+url.QueryEscape(token), nil)
	if verify.Code != http.StatusOK || !strings.Contains(verify.Body.String(), `"email":"new.user@example.com"`) {
		t.Fatalf("verify status = %d body=%s", verify.Code, verify.Body.String())
	}

	complete := consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/activation/complete", map[string]any{
		"token": token, "password": "Passw0rdOK", "confirm_password": "Passw0rdOK",
	})
	if complete.Code != http.StatusOK {
		t.Fatalf("complete status = %d body=%s", complete.Code, complete.Body.String())
	}
	if strings.Contains(complete.Body.String(), "token") {
		t.Fatalf("activation must not issue a session: %s", complete.Body.String())
	}

	user, _, err := store.AuthenticateAdminUser("new.user@example.com", "Passw0rdOK", time.Hour)
	if err != nil {
		t.Fatalf("activated user cannot log in: %v", err)
	}
	if user.Role != "guest" || user.Status != StatusActive {
		t.Fatalf("activated user role=%q status=%q", user.Role, user.Status)
	}

	reused := consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/activation/complete", map[string]any{
		"token": token, "password": "Passw0rdOK", "confirm_password": "Passw0rdOK",
	})
	if reused.Code != http.StatusBadRequest || errorCode(t, reused) != "invalid_activation_token" {
		t.Fatalf("reused token status = %d body=%s", reused.Code, reused.Body.String())
	}

	again := registerWithEmail(t, server, "new.user@example.com")
	if again.Code != http.StatusConflict || errorCode(t, again) != "email_already_registered" {
		t.Fatalf("registered email status = %d body=%s", again.Code, again.Body.String())
	}
}

func TestConsumerRegistrationRejectsWeakPasswordsAndMismatch(t *testing.T) {
	_, server, messages := newConsumerRegistrationTestServer(t)
	if response := registerWithEmail(t, server, "weak@example.com"); response.Code != http.StatusOK {
		t.Fatalf("register status = %d body=%s", response.Code, response.Body.String())
	}
	token, _ := receiveActivationToken(t, messages)
	cases := []struct {
		password, confirm, code string
	}{
		{"short1", "short1", "weak_password"},
		{"onlyletters", "onlyletters", "weak_password"},
		{"1234567890", "1234567890", "weak_password"},
		{strings.Repeat("a1", 37), strings.Repeat("a1", 37), "weak_password"},
		{"Passw0rdOK", "Passw0rdNO", "password_mismatch"},
	}
	for _, tc := range cases {
		response := consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/activation/complete", map[string]any{
			"token": token, "password": tc.password, "confirm_password": tc.confirm,
		})
		if response.Code != http.StatusBadRequest || errorCode(t, response) != tc.code {
			t.Fatalf("password %q status=%d body=%s", tc.password, response.Code, response.Body.String())
		}
	}
	// Rejected attempts must not consume the link.
	verify := consumerRegistrationRequest(t, server, http.MethodGet, "/api/admin/auth/activation/verify?token="+token, nil)
	if verify.Code != http.StatusOK {
		t.Fatalf("token consumed by rejected password: %d %s", verify.Code, verify.Body.String())
	}
}

func TestConsumerRegistrationCooldownAndResendInvalidatesOldLink(t *testing.T) {
	store, server, messages := newConsumerRegistrationTestServer(t)
	if response := registerWithEmail(t, server, "cool@example.com"); response.Code != http.StatusOK {
		t.Fatalf("register status = %d", response.Code)
	}
	first, _ := receiveActivationToken(t, messages)

	limited := registerWithEmail(t, server, "cool@example.com")
	if limited.Code != http.StatusTooManyRequests || errorCode(t, limited) != "activation_rate_limited" {
		t.Fatalf("cooldown status = %d body=%s", limited.Code, limited.Body.String())
	}

	// Age the first link past the cooldown, then resend.
	if err := store.db.Model(&consumerEmailActivation{}).Where("email = ?", "cool@example.com").
		Update("created_at", time.Now().UTC().Add(-2*consumerActivationCooldown)).Error; err != nil {
		t.Fatal(err)
	}
	if response := registerWithEmail(t, server, "cool@example.com"); response.Code != http.StatusOK {
		t.Fatalf("resend status = %d body=%s", response.Code, response.Body.String())
	}
	second, _ := receiveActivationToken(t, messages)
	if first == second {
		t.Fatal("resend reused the activation token")
	}
	old := consumerRegistrationRequest(t, server, http.MethodGet, "/api/admin/auth/activation/verify?token="+first, nil)
	if old.Code != http.StatusBadRequest {
		t.Fatalf("old token still valid after resend: %d", old.Code)
	}
	if fresh := consumerRegistrationRequest(t, server, http.MethodGet, "/api/admin/auth/activation/verify?token="+second, nil); fresh.Code != http.StatusOK {
		t.Fatalf("new token rejected: %d", fresh.Code)
	}
}

func TestConsumerRegistrationRejectsExpiredTokensAndInvalidEmail(t *testing.T) {
	store, server, _ := newConsumerRegistrationTestServer(t)
	plain, _, err := store.CreateConsumerActivation("late@example.com", -time.Minute, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	expired := consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/activation/complete", map[string]any{
		"token": plain, "password": "Passw0rdOK", "confirm_password": "Passw0rdOK",
	})
	if expired.Code != http.StatusBadRequest || errorCode(t, expired) != "invalid_activation_token" {
		t.Fatalf("expired token status = %d body=%s", expired.Code, expired.Body.String())
	}
	for _, email := range []string{"", "not-an-email", "a@b", "Name <x@example.com>"} {
		response := registerWithEmail(t, server, email)
		if response.Code != http.StatusBadRequest || errorCode(t, response) != "invalid_email" {
			t.Fatalf("email %q status = %d body=%s", email, response.Code, response.Body.String())
		}
	}
}

func TestConsumerRegistrationWithoutMailChannelKeepsNoPendingRecord(t *testing.T) {
	store := NewMemoryStore()
	server := NewWithConfig(store, Config{})
	t.Cleanup(func() { _ = server.Shutdown(t.Context()) })
	response := registerWithEmail(t, server, "nomail@example.com")
	if response.Code != http.StatusServiceUnavailable || errorCode(t, response) != "email_delivery_unavailable" {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	var count int64
	if err := store.db.Model(&consumerEmailActivation{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("pending activations = %d err=%v", count, err)
	}
}

func TestConsumerRegistrationRequiresCaptcha(t *testing.T) {
	store, server, _ := newConsumerRegistrationTestServer(t)

	captcha := consumerRegistrationRequest(t, server, http.MethodGet, "/api/admin/auth/register/captcha", nil)
	if captcha.Code != http.StatusOK {
		t.Fatalf("captcha status = %d body=%s", captcha.Code, captcha.Body.String())
	}
	var challenge struct {
		CaptchaID string `json:"captcha_id"`
		Image     string `json:"image"`
	}
	if err := json.Unmarshal(captcha.Body.Bytes(), &challenge); err != nil {
		t.Fatal(err)
	}
	if challenge.CaptchaID == "" || !strings.HasPrefix(challenge.Image, "data:image/png;base64,") {
		t.Fatalf("captcha payload invalid: %s", captcha.Body.String())
	}

	// Activation without a CAPTCHA is rejected before any email handling.
	missing := consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/register/activation", map[string]any{"email": "captcha@example.com"})
	if missing.Code != http.StatusBadRequest || errorCode(t, missing) != "invalid_captcha" {
		t.Fatalf("missing captcha status = %d body=%s", missing.Code, missing.Body.String())
	}

	// An unknown challenge id is rejected as expired.
	unknown := consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/register/activation", map[string]any{
		"email": "captcha@example.com", "captcha_id": "cap_unknown", "captcha_answer": "ABCD",
	})
	if unknown.Code != http.StatusBadRequest || errorCode(t, unknown) != "captcha_expired" {
		t.Fatalf("unknown captcha status = %d body=%s", unknown.Code, unknown.Body.String())
	}

	// A wrong answer is rejected and no activation record is created.
	wrong := consumerRegistrationRequest(t, server, http.MethodPost, "/api/admin/auth/register/activation", map[string]any{
		"email": "captcha@example.com", "captcha_id": challenge.CaptchaID, "captcha_answer": "0000",
	})
	if wrong.Code != http.StatusBadRequest || errorCode(t, wrong) != "invalid_captcha" {
		t.Fatalf("wrong captcha status = %d body=%s", wrong.Code, wrong.Body.String())
	}
	var count int64
	if err := store.db.Model(&consumerEmailActivation{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("pending activations = %d err=%v", count, err)
	}
}
