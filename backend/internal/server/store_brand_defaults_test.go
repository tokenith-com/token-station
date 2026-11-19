package server

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"gorm.io/gorm"
)

func insertBrandFixture(t *testing.T, db *gorm.DB, value any) {
	t.Helper()
	if err := db.Create(value).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(value).Error; err != nil {
		t.Fatal(err)
	}
}

func TestBrandDefaultsPreserveAccountStateAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "brand.db")
	store, err := NewSQLiteStoreWithConfig(path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now().UTC().Truncate(time.Second)
	user := AdminUser{ID: "usr_admin", Username: "admin", Email: "admin@tokenhub.local", Name: "Custom Administrator", Role: "security", Status: "disabled", TeamID: "team_custom", TeamIDs: []string{"team_custom", "team_other"}, PasswordHash: "preserved-password-hash", CreatedAt: now, UpdatedAt: now, LastLoginAt: &now}
	session := AdminSession{Token: "brand-test-session", UserID: user.ID, CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	credential := BootstrapCredential{Name: "admin", Ciphertext: "preserved-ciphertext", CreatedAt: now}
	insertBrandFixture(t, store.db, &user)
	insertBrandFixture(t, store.db, &session)
	insertBrandFixture(t, store.db, &credential)
	// Read persisted timestamps before comparing unchanged account columns.
	if err := store.db.First(&user, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	for pass := 0; pass < 2; pass++ {
		if err := store.Close(); err != nil {
			t.Fatal(err)
		}
		store, err = NewSQLiteStoreWithConfig(path, Config{})
		if err != nil {
			t.Fatal(err)
		}
		var actual AdminUser
		if err := store.db.First(&actual, "id = ?", user.ID).Error; err != nil {
			t.Fatal(err)
		}
		expected := user
		expected.Email = "admin@tokenstation.local"
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("account state changed unexpectedly: %#v", actual)
		}
		var actualSession AdminSession
		if err := store.db.First(&actualSession).Error; err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actualSession, session) {
			t.Fatal("session changed")
		}
		var actualCredential BootstrapCredential
		if err := store.db.First(&actualCredential).Error; err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actualCredential, credential) {
			t.Fatal("bootstrap credential changed")
		}
	}
}

func TestBrandDefaultEmailGuards(t *testing.T) {
	for _, test := range []struct {
		name, id, username, email string
		conflict                  bool
	}{
		{"custom email", "usr_admin", "admin", "admin@example.test", false},
		{"custom username", "usr_admin", "custom", "admin@tokenhub.local", false},
		{"different identity", "usr_other", "admin", "admin@tokenhub.local", false},
		{"target conflict", "usr_admin", "admin", "admin@tokenhub.local", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := newSQLiteIsolationStore(t)
			user := AdminUser{ID: test.id, Username: test.username, Email: test.email}
			insertBrandFixture(t, store.db, &user)
			if test.conflict {
				insertBrandFixture(t, store.db, &AdminUser{ID: "occupied", Username: "occupied", Email: "admin@tokenstation.local"})
			}
			if err := backfillBrandDefaults(store.db); err != nil {
				t.Fatal(err)
			}
			var actual AdminUser
			if err := store.db.First(&actual, "id = ?", user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual, user) {
				t.Fatal("non-default or conflicting account changed")
			}
		})
	}
}

func TestBrandDefaultIdentityProviderGuards(t *testing.T) {
	for _, variant := range []string{"historical", "extra field", "custom field", "missing field", "active", "custom name", "custom description", "different id", "different kind"} {
		t.Run(variant, func(t *testing.T) {
			store := newSQLiteIsolationStore(t)
			resource := AdminResource{ID: "idp_oidc_template", Kind: "identity-providers", Name: "Enterprise OIDC/OAuth Identity Source", Description: "Template for connecting existing SSO, OAuth, or OIDC identity systems for unified login and user sync.", Status: "draft", Fields: historicalIdentityProviderFields()}
			switch variant {
			case "extra field":
				resource.Fields["custom"] = true
			case "custom field":
				resource.Fields["issuer_url"] = "https://custom.example.test"
			case "missing field":
				delete(resource.Fields, "client_secret")
			case "active":
				resource.Status = StatusActive
			case "custom name":
				resource.Name = "Custom SSO"
			case "custom description":
				resource.Description = "Custom description"
			case "different id":
				resource.ID = "custom_sso"
			case "different kind":
				resource.Kind = "settings"
			}
			insertBrandFixture(t, store.db, &resource)
			if variant == "historical" {
				resource.Fields["client_id"] = "tokenstation-admin"
			}
			for pass := 0; pass < 2; pass++ {
				if err := backfillBrandDefaults(store.db); err != nil {
					t.Fatal(err)
				}
				var actual AdminResource
				if err := store.db.Where("id = ? AND kind = ?", resource.ID, resource.Kind).First(&actual).Error; err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(actual, resource) {
					t.Fatalf("unexpected SSO changes for %s", variant)
				}
			}
		})
	}
}

func TestBrandDefaultMockGuards(t *testing.T) {
	for _, variant := range []string{"historical", "custom email", "custom username", "custom user name", "email conflict", "custom provider", "real provider", "custom resource", "custom region", "extra header", "target header"} {
		t.Run(variant, func(t *testing.T) {
			store := newSQLiteIsolationStore(t)
			user := AdminUser{ID: "usr_mock_001", Username: "mock.user001", Name: "Mock User 001", Email: "mock.user001@tokenhub.local", PasswordHash: "preserved"}
			provider := Provider{ID: "prv_mock_001", Name: "Mock Provider 001", Headers: map[string]string{"x-tokenhub-resource-region": mockRegion(2)}}
			resource := ProviderResource{ID: "rsrc_mock_001_1", ProviderID: provider.ID, Name: "Mock Resource Instance 001-1", Headers: map[string]string{"x-tokenhub-resource-region": mockRegion(2)}}
			switch variant {
			case "custom email":
				user.Email = "custom@example.test"
			case "custom username":
				user.Username = "custom"
			case "custom user name":
				user.Name = "Custom User"
			case "email conflict":
				insertBrandFixture(t, store.db, &AdminUser{ID: "occupied", Username: "occupied", Email: "mock.user001@tokenstation.local"})
			case "custom provider":
				provider.Name = "Custom Provider"
			case "real provider":
				provider.ID = "real_provider"
				resource.ProviderID = provider.ID
			case "custom resource":
				resource.Name = "Custom Resource"
			case "custom region":
				resource.Headers["x-tokenhub-resource-region"] = "custom"
			case "extra header":
				resource.Headers["x-custom"] = "preserved"
			case "target header":
				resource.Headers["x-tokenstation-resource-region"] = "custom"
			}
			insertBrandFixture(t, store.db, &user)
			insertBrandFixture(t, store.db, &provider)
			insertBrandFixture(t, store.db, &resource)
			if variant != "custom email" && variant != "custom username" && variant != "custom user name" && variant != "email conflict" {
				user.Email = "mock.user001@tokenstation.local"
			}
			if variant == "historical" || variant == "custom email" || variant == "custom username" || variant == "custom user name" || variant == "email conflict" {
				resource.Headers = map[string]string{"x-tokenstation-resource-region": mockRegion(2)}
			}
			for pass := 0; pass < 2; pass++ {
				if err := backfillBrandDefaults(store.db); err != nil {
					t.Fatal(err)
				}
				var actualUser AdminUser
				var actualProvider Provider
				var actualResource ProviderResource
				if err := store.db.First(&actualUser, "id = ?", user.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := store.db.First(&actualProvider, "id = ?", provider.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := store.db.First(&actualResource, "id = ?", resource.ID).Error; err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(actualUser, user) || !reflect.DeepEqual(actualProvider, provider) || !reflect.DeepEqual(actualResource, resource) {
					t.Fatal("unexpected mock data changes")
				}
			}
		})
	}
}

func TestBrandDefaultsFreshSeed(t *testing.T) {
	store := newSQLiteIsolationStore(t)
	store.CreateResource("teams", AdminResource{ID: "team_platform", Name: "Platform", Status: StatusActive})
	if err := seedBootstrapAdmin(store, "brand-test-password"); err != nil {
		t.Fatal(err)
	}
	if err := seedDefaultOrgResources(store); err != nil {
		t.Fatal(err)
	}
	var user AdminUser
	if err := store.db.First(&user, "id = ?", "usr_admin").Error; err != nil {
		t.Fatal(err)
	}
	if user.Email != "admin@tokenstation.local" {
		t.Fatalf("unexpected default email: %s", user.Email)
	}
	var resource AdminResource
	if err := store.db.First(&resource, "id = ? AND kind = ?", "idp_oidc_template", "identity-providers").Error; err != nil {
		t.Fatal(err)
	}
	if resource.Fields["client_id"] != "tokenstation-admin" {
		t.Fatal("unexpected default client ID")
	}
}

func TestBrandDefaultsTransactionRollback(t *testing.T) {
	store := newSQLiteIsolationStore(t)
	user := AdminUser{ID: "usr_admin", Username: "admin", Email: "admin@tokenhub.local"}
	insertBrandFixture(t, store.db, &user)
	if err := store.db.Exec("CREATE TRIGGER fail_brand_update BEFORE UPDATE ON admin_resources BEGIN SELECT RAISE(ABORT, 'test failure'); END").Error; err != nil {
		t.Fatal(err)
	}
	insertBrandFixture(t, store.db, &AdminResource{ID: "idp_oidc_template", Kind: "identity-providers", Name: "Enterprise OIDC/OAuth Identity Source", Description: "Template for connecting existing SSO, OAuth, or OIDC identity systems for unified login and user sync.", Status: "draft", Fields: historicalIdentityProviderFields()})
	if err := backfillBrandDefaults(store.db); err == nil {
		t.Fatal("expected database error")
	}
	var actual AdminUser
	if err := store.db.First(&actual, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if actual.Email != user.Email {
		t.Fatal("account update was not rolled back")
	}
}
