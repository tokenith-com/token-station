package server

import (
	"encoding/json"
	"fmt"
	"reflect"

	"gorm.io/gorm"
)

// backfillBrandDefaults repairs only recognizable historical seed values under the startup lock.
func backfillBrandDefaults(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := backfillDefaultEmail(tx, "usr_admin", "admin", "", "admin@tokenhub.local", "admin@tokenstation.local"); err != nil {
			return err
		}
		if err := backfillDefaultIdentityProvider(tx); err != nil {
			return err
		}
		for i := 1; i <= 72; i++ {
			username := fmt.Sprintf("mock.user%03d", i)
			if err := backfillDefaultEmail(tx, fmt.Sprintf("usr_mock_%03d", i), username, fmt.Sprintf("Mock User %03d", i), username+"@tokenhub.local", username+"@tokenstation.local"); err != nil {
				return err
			}
		}
		return backfillMockResourceHeaders(tx)
	})
}

func backfillDefaultEmail(tx *gorm.DB, id, username, name, oldEmail, newEmail string) error {
	query := tx.Model(&AdminUser{}).Where("id = ? AND username = ? AND email = ?", id, username, oldEmail)
	if name != "" {
		query = query.Where("name = ?", name)
	}
	return query.Where("NOT EXISTS (?)", tx.Model(&AdminUser{}).Select("1").Where("email = ?", newEmail)).UpdateColumn("email", newEmail).Error
}

func historicalIdentityProviderFields() map[string]any {
	return map[string]any{
		"provider_type": "oidc", "issuer_url": "https://sso.example.com", "client_id": "tokenhub-admin", "client_secret": "",
		"authorize_url": "https://sso.example.com/oauth2/authorize", "token_url": "https://sso.example.com/oauth2/token",
		"userinfo_url": "https://sso.example.com/oauth2/userinfo", "redirect_uri": "http://localhost:8080/api/admin/auth/oauth/callback",
		"scopes": "openid, profile, email", "username_claim": "preferred_username", "email_claim": "email", "team_claim": "department",
	}
}

func backfillDefaultIdentityProvider(tx *gorm.DB) error {
	var rows []struct{ Fields string }
	query := tx.Model(&AdminResource{}).Where("id = ? AND kind = ? AND name = ? AND description = ? AND status = ?",
		"idp_oidc_template", "identity-providers", "Enterprise OIDC/OAuth Identity Source",
		"Template for connecting existing SSO, OAuth, or OIDC identity systems for unified login and user sync.", "draft")
	if err := query.Session(&gorm.Session{}).Select("fields").Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var fields map[string]any
		if json.Unmarshal([]byte(row.Fields), &fields) != nil || !reflect.DeepEqual(fields, historicalIdentityProviderFields()) {
			continue
		}
		fields["client_id"] = "tokenstation-admin"
		updated, err := json.Marshal(fields)
		if err != nil {
			return err
		}
		if err := query.Where("fields = ?", row.Fields).UpdateColumn("fields", string(updated)).Error; err != nil {
			return err
		}
	}
	return nil
}

func backfillMockResourceHeaders(tx *gorm.DB) error {
	for i := 1; i <= 36; i++ {
		providerID := fmt.Sprintf("prv_mock_%03d", i)
		provider := tx.Model(&Provider{}).Select("1").Where("id = ? AND name = ?", providerID, fmt.Sprintf("Mock Provider %03d", i))
		for j := 1; j <= 2; j++ {
			var rows []struct{ Headers string }
			query := tx.Model(&ProviderResource{}).Where("id = ? AND provider_id = ? AND name = ?",
				fmt.Sprintf("rsrc_mock_%03d_%d", i, j), providerID, fmt.Sprintf("Mock Resource Instance %03d-%d", i, j)).Where("EXISTS (?)", provider)
			if err := query.Session(&gorm.Session{}).Select("headers").Scan(&rows).Error; err != nil {
				return err
			}
			for _, row := range rows {
				var headers map[string]string
				if json.Unmarshal([]byte(row.Headers), &headers) != nil || len(headers) != 1 || headers["x-tokenhub-resource-region"] != mockRegion(i+j) {
					continue
				}
				updated, err := json.Marshal(map[string]string{"x-tokenstation-resource-region": mockRegion(i + j)})
				if err != nil {
					return err
				}
				if err := query.Where("headers = ?", row.Headers).UpdateColumn("headers", string(updated)).Error; err != nil {
					return err
				}
			}
		}
	}
	return nil
}
