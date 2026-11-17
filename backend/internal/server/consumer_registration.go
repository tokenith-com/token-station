package server

import (
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"mime"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"
	"unicode"

	"gorm.io/gorm"

	"tokenhub/backend/internal/dbschema"
)

// Self-service consumer (guest) registration by email activation link:
// the visitor submits an email, receives a one-time link, sets a password and
// is then sent back to the login page. No session is issued on activation.

const (
	consumerActivationTTL      = 24 * time.Hour
	consumerActivationCooldown = 60 * time.Second
	consumerPasswordMinLength  = 8
	consumerPasswordMaxLength  = 72
	// consumerActivationProductName is the product name shown in activation emails.
	consumerActivationProductName = "世纪利通TokenStation"
)

type consumerEmailActivation struct {
	ID        string     `gorm:"primaryKey" json:"id"`
	Email     string     `gorm:"index;not null" json:"email"`
	TokenHash string     `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time  `gorm:"not null" json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedAt time.Time  `gorm:"not null" json:"created_at"`
}

func (consumerEmailActivation) TableName() string {
	return "consumer_email_activations"
}

func consumerEmailActivationMigration() dbschema.Migration {
	return dbschema.Migration{Version: 15, Name: "add-consumer-email-activations", Statements: []string{
		`CREATE TABLE IF NOT EXISTS consumer_email_activations (id text PRIMARY KEY, email text NOT NULL, token_hash text NOT NULL, expires_at timestamp NOT NULL, used_at timestamp, created_at timestamp NOT NULL)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_consumer_email_activations_token_hash ON consumer_email_activations (token_hash)`,
		`CREATE INDEX IF NOT EXISTS idx_consumer_email_activations_email ON consumer_email_activations (email)`,
	}, StatementBudget: 3}
}

type consumerActivationStore interface {
	CreateConsumerActivation(email string, ttl, cooldown time.Duration) (string, consumerEmailActivation, error)
	DeleteConsumerActivation(id string) error
	LookupConsumerActivation(token string) (consumerEmailActivation, error)
	CompleteConsumerActivation(token, password string) (AdminUser, error)
}

var errConsumerActivationInvalid = NewHTTPError(400, "invalid_activation_token", "Activation link is invalid or expired")

func normalizeConsumerEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" || len(email) > 254 {
		return "", NewHTTPError(400, "invalid_email", "A valid email address is required")
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || !strings.Contains(email[strings.LastIndex(email, "@")+1:], ".") {
		return "", NewHTTPError(400, "invalid_email", "A valid email address is required")
	}
	return email, nil
}

func validateConsumerPassword(password string) error {
	if len(password) < consumerPasswordMinLength || len(password) > consumerPasswordMaxLength {
		return NewHTTPError(400, "weak_password", "Password must be 8-72 characters and contain both letters and digits")
	}
	hasLetter, hasDigit := false, false
	for _, r := range password {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return NewHTTPError(400, "weak_password", "Password must be 8-72 characters and contain both letters and digits")
	}
	return nil
}

func (s *GormStore) CreateConsumerActivation(email string, ttl, cooldown time.Duration) (string, consumerEmailActivation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plain, err := randomHex(32)
	if err != nil {
		return "", consumerEmailActivation{}, err
	}
	now := time.Now().UTC()
	record := consumerEmailActivation{
		ID:        NewID("act"),
		Email:     email,
		TokenHash: HashSecret(plain),
		ExpiresAt: now.Add(ttl),
		CreatedAt: now,
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var users int64
		if err := tx.Model(&AdminUser{}).Where("LOWER(email) = ? OR LOWER(username) = ?", email, email).Count(&users).Error; err != nil {
			return err
		}
		if users > 0 {
			return NewHTTPError(409, "email_already_registered", "This email is already registered")
		}
		var recent int64
		if err := tx.Model(&consumerEmailActivation{}).
			Where("email = ? AND used_at IS NULL AND created_at > ?", email, now.Add(-cooldown)).
			Count(&recent).Error; err != nil {
			return err
		}
		if recent > 0 {
			return NewHTTPError(429, "activation_rate_limited", "Activation email was sent recently; please try again later")
		}
		// A resend invalidates every earlier pending link for the same address.
		if err := tx.Where("email = ? AND used_at IS NULL", email).Delete(&consumerEmailActivation{}).Error; err != nil {
			return err
		}
		return tx.Create(&record).Error
	})
	if err != nil {
		return "", consumerEmailActivation{}, err
	}
	return plain, record, nil
}

func (s *GormStore) DeleteConsumerActivation(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Where("id = ?", id).Delete(&consumerEmailActivation{}).Error
}

func (s *GormStore) LookupConsumerActivation(token string) (consumerEmailActivation, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return consumerEmailActivation{}, errConsumerActivationInvalid
	}
	var record consumerEmailActivation
	err := s.db.Where("token_hash = ? AND used_at IS NULL AND expires_at > ?", HashSecret(token), time.Now().UTC()).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return consumerEmailActivation{}, errConsumerActivationInvalid
	}
	return record, err
}

func ensureBuiltinConsumerProject(tx *gorm.DB) (Project, error) {
	var project Project
	err := tx.First(&project, "id = ?", consumerProjectID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		project = Project{
			ID:          consumerProjectID,
			Name:        "C端普通用户项目",
			OwnerUserID: "usr_admin",
			CostCenter:  consumerCostCenterCode,
			Status:      StatusActive,
		}
		if err := tx.Create(&project).Error; err != nil {
			return Project{}, err
		}
		return project, nil
	}
	if err != nil {
		return Project{}, err
	}
	project.TeamID = ""
	project.CostCenter = consumerCostCenterCode
	project.Status = StatusActive
	project.UpdatedAt = time.Now().UTC()
	if err := tx.Save(&project).Error; err != nil {
		return Project{}, err
	}
	if err := tx.Where("project_id = ?", consumerProjectID).Delete(&ProjectTeam{}).Error; err != nil {
		return Project{}, err
	}
	return project, nil
}

func (s *GormStore) CompleteConsumerActivation(token, password string) (AdminUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	token = strings.TrimSpace(token)
	if token == "" {
		return AdminUser{}, errConsumerActivationInvalid
	}
	var created AdminUser
	err := s.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		var record consumerEmailActivation
		err := tx.Where("token_hash = ? AND used_at IS NULL AND expires_at > ?", HashSecret(token), now).First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errConsumerActivationInvalid
		}
		if err != nil {
			return err
		}
		claim := tx.Model(&consumerEmailActivation{}).Where("id = ? AND used_at IS NULL", record.ID).Update("used_at", now)
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected != 1 {
			return errConsumerActivationInvalid
		}
		user, err := createAdminUser(tx, AdminUser{
			Username: record.Email,
			Email:    record.Email,
			Name:     record.Email[:strings.Index(record.Email, "@")],
			Role:     "consumer",
			Status:   StatusActive,
		}, password)
		if err != nil {
			var httpErr *HTTPError
			if errors.As(err, &httpErr) && httpErr.Code == "admin_user_conflict" {
				return NewHTTPError(409, "email_already_registered", "This email is already registered")
			}
			return err
		}
		project, err := ensureBuiltinConsumerProject(tx)
		if err != nil {
			return err
		}
		scoped := &GormStore{db: tx}
		if _, err := scoped.createResourceLocked("project-members", AdminResource{
			Name: project.Name + " / " + user.Username,
			Fields: map[string]any{
				"project_id":     consumerProjectID,
				"user_id":        user.ID,
				"role":           "developer",
				"can_issue_keys": true,
				"provisioned_by": "registration",
			},
		}, false); err != nil {
			return err
		}
		created = user
		return nil
	})
	return created, err
}

func (s *Server) consumerActivationStore() (consumerActivationStore, error) {
	store, ok := s.store.(consumerActivationStore)
	if !ok {
		return nil, NewHTTPError(501, "registration_unavailable", "Self-service registration is not available")
	}
	return store, nil
}

func (s *Server) handleConsumerRegisterActivation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email         string `json:"email"`
		CaptchaID     string `json:"captcha_id"`
		CaptchaAnswer string `json:"captcha_answer"`
	}
	if err := s.decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if err := s.consumeConsumerCaptcha(req.CaptchaID, req.CaptchaAnswer); err != nil {
		writeError(w, r, err)
		return
	}
	email, err := normalizeConsumerEmail(req.Email)
	if err != nil {
		writeError(w, r, err)
		return
	}
	store, err := s.consumerActivationStore()
	if err != nil {
		writeError(w, r, err)
		return
	}
	channel, err := s.resolvePasswordResetMailChannel()
	if err != nil {
		writeError(w, r, NewHTTPError(503, "email_delivery_unavailable", "Email delivery is not configured"))
		return
	}
	plain, record, err := store.CreateConsumerActivation(email, consumerActivationTTL, consumerActivationCooldown)
	if err != nil {
		writeError(w, r, err)
		return
	}
	link := s.consumerActivationLink(r, plain)
	message := consumerActivationEmailMessage(channel.Fields, email, link, consumerActivationTTL)
	if err := sendEmail(r.Context(), channel.Fields, []string{email}, message, s.smtpRootCAs); err != nil {
		_ = store.DeleteConsumerActivation(record.ID)
		safe := *AsHTTPError(err)
		safe.Message = redactNotificationChannelSecrets(safe.Message, channel)
		writeError(w, r, NewHTTPError(502, "activation_email_failed", "Failed to send activation email: "+safe.Message))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"email":              email,
		"expires_at":         record.ExpiresAt,
		"resend_after_secs":  int(consumerActivationCooldown.Seconds()),
		"activation_sent":    true,
		"activation_ttl_hrs": int(consumerActivationTTL.Hours()),
	})
}

func (s *Server) handleConsumerActivationVerify(w http.ResponseWriter, r *http.Request) {
	store, err := s.consumerActivationStore()
	if err != nil {
		writeError(w, r, err)
		return
	}
	record, err := store.LookupConsumerActivation(r.URL.Query().Get("token"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": record.Email, "expires_at": record.ExpiresAt})
}

func (s *Server) handleConsumerActivationComplete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token           string `json:"token"`
		Password        string `json:"password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := s.decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		writeError(w, r, errConsumerActivationInvalid)
		return
	}
	if req.Password != req.ConfirmPassword {
		writeError(w, r, NewHTTPError(400, "password_mismatch", "Passwords do not match"))
		return
	}
	if err := validateConsumerPassword(req.Password); err != nil {
		writeError(w, r, err)
		return
	}
	store, err := s.consumerActivationStore()
	if err != nil {
		writeError(w, r, err)
		return
	}
	user, err := store.CompleteConsumerActivation(req.Token, req.Password)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) consumerActivationLink(r *http.Request, token string) string {
	origin := ""
	if candidate, ok := normalizedOAuthOrigin(r.Header.Get("Origin"), true); ok {
		if target, err := url.Parse(candidate); err == nil && isAllowedOAuthReturnOrigin(target, s.config, r) {
			origin = candidate
		}
	}
	if origin == "" {
		fallback, ok := normalizedOAuthOrigin(canonicalOAuthReturnURL(s.config, r), false)
		if !ok {
			fallback = "http://localhost:3000"
		}
		origin = fallback
	}
	values := url.Values{}
	values.Set("activation_token", token)
	return oauthRedirectWithFragment(origin+"/", values)
}

func consumerActivationEmailMessage(fields map[string]any, recipient, link string, ttl time.Duration) []byte {
	fromAddress := strings.TrimSpace(firstStringField(fields, "smtp_from", "from_email", "from"))
	fromName := strings.TrimSpace(firstStringField(fields, "smtp_from_name", "from_name"))
	siteName := consumerActivationProductName
	from := fromAddress
	if fromName != "" {
		from = (&mail.Address{Name: fromName, Address: fromAddress}).String()
	}
	subject := mime.BEncoding.Encode("UTF-8", sanitizeEmailHeader(fmt.Sprintf("[%s] 请激活您的账号", siteName)))
	hours := int(ttl.Hours())
	plain := fmt.Sprintf("您好，\r\n\r\n感谢注册 %s。请打开下方链接设置密码并激活账号：\r\n\r\n激活账号：%s\r\n\r\n该链接 %d 小时内有效，且仅可使用一次。\r\n如果这不是您本人的操作，请忽略此邮件。\r\n",
		siteName, link, hours)
	now := time.Now()
	boundary := fmt.Sprintf("tokenhub-activation-%x", now.UnixNano())
	domain := "localhost"
	if at := strings.LastIndex(fromAddress, "@"); at >= 0 && at < len(fromAddress)-1 {
		domain = fromAddress[at+1:]
	}
	nonce, err := randomHex(12)
	if err != nil {
		nonce = fmt.Sprintf("%x", now.UnixNano())
	}
	var message strings.Builder
	fmt.Fprintf(&message, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMessage-ID: <%s.%s@%s>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=%q\r\n\r\n",
		sanitizeEmailHeader(from), sanitizeEmailHeader(recipient), subject, now.Format(time.RFC1123Z), nonce, "activation", sanitizeEmailHeader(domain), boundary)
	fmt.Fprintf(&message, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n%s", boundary, base64MIMEBody(plain))
	fmt.Fprintf(&message, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n%s", boundary, base64MIMEBody(consumerActivationEmailHTML(siteName, link, hours)))
	fmt.Fprintf(&message, "--%s--\r\n", boundary)
	return []byte(message.String())
}

// base64MIMEBody encodes a MIME part body as base64 wrapped at 76 characters.
func base64MIMEBody(body string) string {
	encoded := base64.StdEncoding.EncodeToString([]byte(body))
	var out strings.Builder
	for len(encoded) > 76 {
		out.WriteString(encoded[:76])
		out.WriteString("\r\n")
		encoded = encoded[76:]
	}
	out.WriteString(encoded)
	out.WriteString("\r\n")
	return out.String()
}

// consumerActivationEmailHTML renders a card-style activation email using the
// portal's purple brand palette.
func consumerActivationEmailHTML(siteName, link string, hours int) string {
	name := html.EscapeString(siteName)
	safeLink := html.EscapeString(link)
	initial := html.EscapeString(string([]rune(siteName)[:1]))
	year := time.Now().Year()
	lines := []string{
		`<!DOCTYPE html>`,
		`<html lang="zh-CN"><head><meta charset="UTF-8">`,
		`<meta name="viewport" content="width=device-width,initial-scale=1"></head>`,
		`<body style="margin:0;padding:0;background:#f4f1f9;">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"`,
		` style="background:#f4f1f9;padding:40px 16px;font-family:-apple-system,`,
		`'PingFang SC','Microsoft YaHei',Segoe UI,Roboto,Helvetica,Arial,sans-serif;">`,
		`<tr><td align="center">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"`,
		` style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;`,
		`box-shadow:0 8px 32px rgba(116,73,173,0.12);">`,
		`<tr><td style="background:#7449ad;background:linear-gradient(135deg,#8a5fc4,#5f3a8e);`,
		`padding:32px 40px;text-align:center;">`,
		`<div style="display:inline-block;width:48px;height:48px;line-height:48px;`,
		`border-radius:12px;background:rgba(255,255,255,0.18);color:#ffffff;`,
		`font-size:22px;font-weight:700;">` + initial + `</div>`,
		`<div style="margin-top:12px;color:#ffffff;font-size:20px;font-weight:700;">` + name + `</div>`,
		`</td></tr>`,
		`<tr><td style="padding:36px 40px 8px;">`,
		`<h1 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:700;">验证您的邮箱</h1>`,
		`<p style="margin:0 0 8px;color:#4b5563;font-size:15px;line-height:1.7;">您好，</p>`,
		`<p style="margin:0;color:#4b5563;font-size:15px;line-height:1.7;">感谢注册 ` + name + `。`,
		`请点击下方按钮设置密码并激活账号。</p>`,
		`</td></tr>`,
		`<tr><td align="center" style="padding:28px 40px;">`,
		`<a href="` + safeLink + `" target="_blank" style="display:inline-block;padding:14px 40px;`,
		`border-radius:12px;background:#7449ad;background:linear-gradient(90deg,#8a5fc4,#7449ad);`,
		`color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;`,
		`box-shadow:0 4px 12px rgba(138,95,196,0.3);">激活账号</a>`,
		`</td></tr>`,
		`<tr><td style="padding:0 40px;">`,
		`<div style="border:1px solid #ebe3f5;border-radius:12px;background:#f9f6fc;padding:16px;">`,
		`<p style="margin:0 0 6px;color:#6b7280;font-size:13px;">按钮无法点击？请复制以下链接到浏览器打开：</p>`,
		`<a href="` + safeLink + `" target="_blank" style="color:#7449ad;font-size:13px;`,
		`word-break:break-all;text-decoration:none;">` + safeLink + `</a>`,
		`</div>`,
		`</td></tr>`,
		`<tr><td style="padding:24px 40px 32px;">`,
		fmt.Sprintf(`<p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.6;">该链接 %d 小时内有效，且仅可使用一次。</p>`, hours),
		`<p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6;">如果这不是您本人的操作，请忽略此邮件。</p>`,
		`</td></tr>`,
		`<tr><td style="border-top:1px solid #f0ebf7;padding:20px 40px;text-align:center;">`,
		`<p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">此邮件由系统自动发送，请勿直接回复。</p>`,
		fmt.Sprintf(`<p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">&copy; %d %s</p>`, year, name),
		`</td></tr>`,
		`</table>`,
		`</td></tr></table>`,
		`</body></html>`,
	}
	return strings.Join(lines, "\r\n")
}
