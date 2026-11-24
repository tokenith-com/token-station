package server

import (
	"net/http"
	"strings"

	"gorm.io/gorm"
)

// userModelAccessResourceKind stores a per-user model scope. It rides on the
// generic admin resource table so it inherits audited writes, listing and the
// existing role filters instead of introducing a parallel store.
const userModelAccessResourceKind = "user-model-access"

// userModelAccess is the resolved scope for one user. A user without a record
// inherits the project scope unchanged.
type userModelAccess struct {
	UserID     string
	Mode       string
	Allowed    map[string]bool
	Excluded   map[string]bool
	Configured bool
}

// userModelAccessFor resolves the scope recorded for the key's owning user.
// Ownership, not the caller, decides the scope: a key handed to someone else
// keeps the limits of the account it belongs to.
func userModelAccessFor(resources []AdminResource, userID string) userModelAccess {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return userModelAccess{}
	}
	for _, item := range resources {
		if item.Status != "" && item.Status != StatusActive {
			continue
		}
		if strings.TrimSpace(stringField(item.Fields, "user_id")) != userID {
			continue
		}
		mode := strings.ToLower(strings.TrimSpace(stringField(item.Fields, "model_access_mode")))
		access := userModelAccess{UserID: userID, Mode: mode, Configured: mode != ""}
		if mode == ModelAccessModeRestricted {
			access.Allowed = modelNameSet(item.Fields["allowed_models"])
		}
		if mode == ModelAccessModeExcluded {
			access.Excluded = modelNameSet(item.Fields["excluded_models"])
		}
		return access
	}
	return userModelAccess{}
}

// modelNameSet reads a model list from either a JSON array or the
// comma-separated string the admin form submits for a multi-select field.
func modelNameSet(value any) map[string]bool {
	out := map[string]bool{}
	for _, name := range stringSliceFromPayload(value) {
		if name = strings.TrimSpace(name); name != "" {
			out[name] = true
		}
	}
	return out
}

// userModelAccessReasons reports why the user's own scope rejects a model.
// An unconfigured user adds no reason, so existing accounts keep working.
func userModelAccessReasons(access userModelAccess, modelName string) []string {
	if !access.Configured {
		return nil
	}
	switch access.Mode {
	case ModelAccessModeRestricted:
		if !access.Allowed[modelName] {
			return []string{"user_model_not_allowed"}
		}
	case ModelAccessModeExcluded:
		if access.Excluded[modelName] {
			return []string{"user_model_excluded"}
		}
	}
	return nil
}

// validateUserModelAccessMutation rejects a scope that would widen the project
// boundary. A user scope may only narrow what the project already allows.
func (s *Server) validateUserModelAccessMutation(user AdminUser, resourceID string, req AdminResource) error {
	fields := req.Fields
	if resourceID != "" && fields == nil {
		existing, err := s.findResource(userModelAccessResourceKind, resourceID)
		if err != nil {
			return err
		}
		fields = existing.Fields
	}
	targetUserID := strings.TrimSpace(stringField(fields, "user_id"))
	if targetUserID == "" {
		return NewHTTPError(http.StatusBadRequest, "invalid_user_model_access", "user_id is required")
	}
	target, ok := s.findAdminUser(targetUserID)
	if !ok {
		return NewHTTPError(http.StatusNotFound, "admin_user_not_found", "User not found")
	}
	if normalizeAdminRole(user.Role) == "team_leader" && !userHasTeam(target, user.TeamID) {
		return NewHTTPError(http.StatusForbidden, "model_access_forbidden", "Team leader can only manage model access for users in own team")
	}
	mode := strings.ToLower(strings.TrimSpace(stringField(fields, "model_access_mode")))
	switch mode {
	case "", ModelAccessModeInherit:
		return nil
	case ModelAccessModeRestricted:
		selected := modelNameSet(fields["allowed_models"])
		if len(selected) == 0 {
			return NewHTTPError(http.StatusBadRequest, "invalid_user_model_access", "A restricted scope needs at least one model")
		}
		return s.ensureModelsWithinProjectScope(targetUserID, selected, true)
	case ModelAccessModeExcluded:
		return s.ensureModelsWithinProjectScope(targetUserID, modelNameSet(fields["excluded_models"]), false)
	default:
		return NewHTTPError(http.StatusBadRequest, "invalid_user_model_access", "model_access_mode must be inherit, restricted, or excluded")
	}
}

// ensureModelsWithinProjectScope checks every project the user belongs to. A
// model the user can never reach through their projects must not appear in a
// user scope, so misconfiguration surfaces at save time instead of at call time.
func (s *Server) ensureModelsWithinProjectScope(userID string, models map[string]bool, requireAll bool) error {
	if len(models) == 0 {
		return nil
	}
	projects := s.projectsForUserModelScope(userID)
	for modelName := range models {
		reachable := false
		for _, project := range projects {
			if modelAllowedByProjectScope(project, modelName) {
				reachable = true
				break
			}
		}
		if !reachable && requireAll {
			return NewHTTPError(http.StatusBadRequest, "user_model_exceeds_project", "A model outside the user's project scope cannot be granted")
		}
	}
	return nil
}

func (s *Server) projectsForUserModelScope(userID string) []Project {
	projects := s.store.ListProjects()
	memberships := s.store.ListResources("project-members")
	activeTeams := s.activeTeamIDSet()
	target, ok := s.findAdminUser(userID)
	if !ok {
		return nil
	}
	out := make([]Project, 0, len(projects))
	for _, project := range projects {
		if project.Status != "" && project.Status != StatusActive {
			continue
		}
		if projectAccessRole(target, project, memberships, activeTeams) != "" {
			out = append(out, project)
		}
	}
	return out
}

func modelAllowedByProjectScope(project Project, modelName string) bool {
	hydrateProject(&project)
	if project.ModelAccessMode == ModelAccessModeRestricted && !AllowedModelSet(project.AllowedModels)[modelName] {
		return false
	}
	if project.ModelAccessMode == ModelAccessModeExcluded && AllowedModelSet(project.ExcludedModels)[modelName] {
		return false
	}
	return true
}

func (s *Server) userModelAccessResources() []AdminResource {
	return s.store.ListResources(userModelAccessResourceKind)
}

// userModelAccessResourceRows reads the scopes inside a store transaction for
// callers that already hold the write lock.
func (s *GormStore) userModelAccessResourceRows() ([]AdminResource, error) {
	var resources []AdminResource
	err := s.db.Where("kind = ?", userModelAccessResourceKind).Find(&resources).Error
	return resources, err
}

// modelAllowedForCall applies all three scopes for one admission decision.
func (s *GormStore) modelAllowedForCall(tx *gorm.DB, project Project, key APIKey, modelName string) bool {
	return len(s.modelAccessReasonsForCall(tx, project, key, modelName)) == 0
}

// modelAccessReasonsForCall resolves the owning user's scope inside the caller's
// transaction so admission reads a consistent snapshot.
func (s *GormStore) modelAccessReasonsForCall(tx *gorm.DB, project Project, key APIKey, modelName string) []string {
	var resources []AdminResource
	if err := tx.Where("kind = ?", userModelAccessResourceKind).Find(&resources).Error; err != nil {
		// A scope lookup failure must not silently widen access.
		return []string{"user_model_access_unavailable"}
	}
	access := userModelAccessFor(resources, usageAttributionUserID(key, project))
	return modelAccessReasonsWithUser(project, key, access, modelName)
}

// modelAllowedForScopes is the store-level variant used where the user's scope
// is already resolved in memory (model listing, routing policy previews).
func modelAllowedForScopes(resources []AdminResource, project Project, key APIKey, modelName string) bool {
	access := userModelAccessFor(resources, usageAttributionUserID(key, project))
	return len(modelAccessReasonsWithUser(project, key, access, modelName)) == 0
}

// modelAllowedForCredential applies all three scopes for a listing, resolving
// the owning user's scope itself.
func (s *GormStore) modelAllowedForCredential(project Project, key APIKey, modelName string) bool {
	resources, err := s.userModelAccessResourceRows()
	if err != nil {
		return false
	}
	return modelAllowedForScopes(resources, project, key, modelName)
}
