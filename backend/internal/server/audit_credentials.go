package server

import (
	"context"
	"sort"
	"sync"
)

type auditCredentialCaptureKey struct{}

// A collector belongs to one request. Never persist it or retain credential maps.
type auditCredentialCapture struct {
	mu      sync.Mutex
	secrets map[string]bool
}

func (c *auditCredentialCapture) add(provider Provider) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.secrets == nil {
		c.secrets = make(map[string]bool)
	}
	for _, secret := range providerErrorSecretValues(provider) {
		c.secrets[secret] = true
	}
}

func (c *auditCredentialCapture) redact(raw []byte) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	secrets := make([]string, 0, len(c.secrets))
	for secret := range c.secrets {
		secrets = append(secrets, secret)
	}
	sort.Slice(secrets, func(i, j int) bool { return len(secrets[i]) > len(secrets[j]) })
	for _, secret := range secrets {
		raw = redactProviderErrorSecrets(raw, Provider{APIKey: secret})
	}
	return raw
}

func (w *streamWriteTracker) auditContext(ctx context.Context) context.Context {
	if w.capture == nil {
		return ctx
	}
	if w.capture.credentials == nil {
		w.capture.credentials = &auditCredentialCapture{}
	}
	return context.WithValue(ctx, auditCredentialCaptureKey{}, w.capture.credentials)
}

func captureAuditCredentials(ctx context.Context, credentials ProviderResourceCredentials) {
	if capture, ok := ctx.Value(auditCredentialCaptureKey{}).(*auditCredentialCapture); ok {
		capture.add(Provider{APIKey: credentials.AccessToken})
		capture.add(Provider{APIKey: credentials.RefreshToken})
		capture.add(Provider{APIKey: credentials.IDToken})
		capture.add(Provider{APIKey: credentials.ClientSecret})
	}
}
