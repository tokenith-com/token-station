package server

import (
	"net/http"
	"strings"

	"gorm.io/gorm"
)

// catalogReferenceModelSources are the metadata sources whose models describe
// upstream catalog entries rather than published models. A model from one of
// these sources is reachable upstream but has not been published to the
// external model directory, so it is not a grantable project or key model.
var catalogReferenceModelSources = map[string]bool{
	"tokenhub-standard-catalog": true,
	"public-provider-conf":      true,
}

// modelInExternalDirectory mirrors the admin console's modelIsInDirectory so a
// model the console cannot offer is also not grantable through the API.
func modelInExternalDirectory(tx *gorm.DB, model Model) bool {
	if model.Metadata[modelDirectoryRoleKey] == modelDirectoryRoleExternal {
		return true
	}
	var routes int64
	if err := tx.Model(&ModelRoute{}).Where("model_name = ?", model.Name).Count(&routes).Error; err == nil && routes > 0 {
		return true
	}
	return !catalogReferenceModelSources[strings.TrimSpace(model.Metadata["source"])]
}

// validateDirectoryModels rejects models that are active but absent from the
// external model directory. The directory is the platform-level publication
// decision, so an unpublished model cannot be granted to a project or key.
func validateDirectoryModels(tx *gorm.DB, modelNames []string) error {
	for _, modelName := range modelNames {
		var model Model
		if err := tx.First(&model, "name = ? AND status = ?", modelName, StatusActive).Error; err != nil {
			return NewHTTPError(404, "model_not_found", "Model not found")
		}
		if !modelInExternalDirectory(tx, model) {
			return NewHTTPError(400, "model_not_in_directory", "Model is not published to the external model directory")
		}
	}
	return nil
}

// validateProjectModelAccess constrains a project's allow list to the external
// model directory. A deny list only removes access, so it may name any active
// model the platform has configured.
func validateProjectModelAccess(tx *gorm.DB, allowed, excluded []string) error {
	if err := validateDirectoryModels(tx, allowed); err != nil {
		return err
	}
	return validateActiveModels(tx, excluded)
}

// validateActiveModels checks that every name resolves to an active model
// without requiring directory publication.
func validateActiveModels(tx *gorm.DB, modelNames []string) error {
	for _, modelName := range modelNames {
		var count int64
		if err := tx.Model(&Model{}).Where("name = ? AND status = ?", modelName, StatusActive).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return NewHTTPError(http.StatusNotFound, "model_not_found", "Model not found")
		}
	}
	return nil
}

// rejectProjectModelScopeWrite keeps the project model scope inside platform
// administration. Team leaders narrow the effective scope through the per-user
// scope and per-key allow list instead; they cannot raise the ceiling.
func rejectProjectModelScopeWrite(user AdminUser, mode string, allowed, excluded []string) error {
	if isPlatformAdminRole(user.Role) {
		return nil
	}
	if strings.TrimSpace(mode) == "" && len(allowed) == 0 && len(excluded) == 0 {
		return nil
	}
	return NewHTTPError(http.StatusForbidden, "project_model_scope_forbidden",
		"Only platform administrators can change a project's model access scope")
}
