package server

import (
	"fmt"
	"net/http"
	"strings"
)

// Team member provisioning: team leaders (and platform admins) create ordinary
// accounts here and the new member is assigned to the first project space the
// actor can manage, so a separate project-members call is not needed.

func (s *Server) registerTeamMemberRoutes() {
	s.registerSingleMethodRoute(http.MethodPost, "/api/admin/team-members", s.handleAdminTeamMemberPost, s.adminMethodNotAllowed("identity", http.MethodPost))
}

func (s *Server) handleAdminTeamMemberPost(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireAdmin(w, r, "identity", r.Method)
	if !ok {
		return
	}
	var req struct {
		Username    string `json:"username"`
		Name        string `json:"name"`
		Email       string `json:"email"`
		Password    string `json:"password"`
		Status      string `json:"status"`
		TeamID      string `json:"team_id"`
		ProjectRole string `json:"project_role"`
	}
	if err := s.decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	teamID := strings.TrimSpace(req.TeamID)
	if normalizeAdminRole(actor.Role) == "team_leader" {
		if teamID != "" && teamID != actor.TeamID {
			writeError(w, r, NewHTTPError(http.StatusForbidden, "team_forbidden", "Team leader can only manage own team"))
			return
		}
		teamID = actor.TeamID
	}
	if teamID == "" {
		writeError(w, r, NewHTTPError(http.StatusBadRequest, "invalid_team_member", "team_id is required"))
		return
	}
	projectRole := strings.ToLower(strings.TrimSpace(req.ProjectRole))
	if projectRole == "" {
		projectRole = "developer"
	}
	if !validProjectMemberRole(projectRole) {
		writeError(w, r, NewHTTPError(http.StatusBadRequest, "invalid_project_member", "role must be owner, maintainer, developer, or viewer"))
		return
	}
	// Resolve the target project space before creating the account so a missing
	// project space never leaves an orphaned user behind.
	project, ok := s.firstManageableProject(actor)
	if !ok {
		writeError(w, r, NewHTTPError(http.StatusConflict, "default_project_unavailable", "No manageable project space is available"))
		return
	}
	user, err := s.store.CreateAdminUser(AdminUser{
		Username: req.Username,
		Name:     req.Name,
		Email:    req.Email,
		Role:     "user",
		TeamID:   teamID,
		TeamIDs:  []string{teamID},
		Status:   req.Status,
	}, req.Password)
	if err != nil {
		writeError(w, r, err)
		return
	}
	displayName := user.Name
	if strings.TrimSpace(displayName) == "" {
		displayName = user.Username
	}
	membership := s.store.CreateResource("project-members", AdminResource{
		Name:   fmt.Sprintf("%s / %s", project.Name, displayName),
		Status: StatusActive,
		Fields: map[string]any{
			"project_id":     project.ID,
			"user_id":        user.ID,
			"role":           projectRole,
			"can_issue_keys": projectMemberRoleCanIssueKey(projectRole),
			"provisioned_by": "team_member_create",
		},
	})
	s.recordAdminAudit(r, actor, "create", "admin_user", user.ID, "", map[string]any{
		"user":              user,
		"project_id":        project.ID,
		"project_member_id": membership.ID,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":              user,
		"project_id":        project.ID,
		"project_member_id": membership.ID,
	})
}

// firstManageableProject returns the first active project space the actor can
// manage, in project list order.
func (s *Server) firstManageableProject(actor AdminUser) (Project, bool) {
	for _, project := range s.store.ListProjects() {
		if project.Status != "" && project.Status != StatusActive {
			continue
		}
		if s.canManageProject(actor, project) {
			return project, true
		}
	}
	return Project{}, false
}
