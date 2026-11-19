package server

import (
	"net/http"
	"strings"
)

const platformAdminDisplayName = "平台超管"

func prepareRoleConfig(resource *AdminResource) error {
	roleKey := strings.TrimSpace(stringField(resource.Fields, "role_key"))
	if roleKey == "" {
		roleKey = strings.TrimSpace(resource.ID)
	}
	switch strings.ToLower(roleKey) {
	case "system_admin":
		return NewHTTPError(http.StatusBadRequest, "legacy_role_config", "Use admin instead of the retired system_admin role key")
	case "admin":
		resource.Name = platformAdminDisplayName
		resource.Fields = cloneFields(resource.Fields)
		resource.Fields["role_key"] = "admin"
		resource.Fields["display_name"] = platformAdminDisplayName
	}
	return nil
}
