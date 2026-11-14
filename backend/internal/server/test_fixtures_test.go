package server

import (
	"context"
	"testing"
	"time"
)

func newTestMemoryStore(t testing.TB) *MemoryStore {
	t.Helper()
	return newTestMemoryStoreWithConfig(t, ConfigFromEnv())
}

func newTestMemoryStoreWithConfig(t testing.TB, config Config) *MemoryStore {
	t.Helper()
	store := NewMemoryStoreWithConfig(config)
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close test store: %v", err)
		}
	})
	return store
}

func newManagedTestServer(t testing.TB, store Store) *Server {
	t.Helper()
	return newManagedTestServerWithConfig(t, store, Config{AdminToken: "dev_admin_token"})
}

func newManagedTestServerWithConfig(t testing.TB, store Store, config Config) *Server {
	t.Helper()
	return newTestServerWithShutdown(t, store, config, false)
}

func newTestServerWithClosedDatabase(t testing.TB, store Store, config Config) *Server {
	t.Helper()
	return newTestServerWithShutdown(t, store, config, true)
}

func newTestServerWithShutdown(t testing.TB, store Store, config Config, closesDatabase bool) *Server {
	t.Helper()
	app := NewWithConfig(store, config)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := app.Shutdown(ctx); err != nil && !(closesDatabase && isClosedDatabaseError(err)) {
			t.Errorf("shut down test server: %v", err)
		}
	})
	return app
}
