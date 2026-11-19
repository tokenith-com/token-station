package server

import "testing"

func TestTeamLeaderUserListHidesPlatformAdmins(t *testing.T) {
	s := &Server{}
	leader := AdminUser{ID: "usr_leader", Role: "team_leader", TeamID: "team_a"}
	users := []AdminUser{
		leader,
		{ID: "usr_member", Role: "user", TeamID: "team_a"},
		{ID: "usr_admin", Role: "admin", TeamID: "team_a"},
		{ID: "usr_other_admin", Role: "admin", TeamIDs: []string{"team_a"}},
		{ID: "usr_other", Role: "user", TeamID: "team_b"},
	}

	got := map[string]bool{}
	for _, item := range s.filterAdminUsersForUser(leader, users) {
		got[item.ID] = true
	}
	if len(got) != 2 || !got["usr_leader"] || !got["usr_member"] {
		t.Fatalf("team leader should only see non-admin members of its team, got %v", got)
	}

	if all := s.filterAdminUsersForUser(AdminUser{ID: "usr_admin", Role: "admin"}, users); len(all) != len(users) {
		t.Fatalf("platform admin should see every account, got %d of %d", len(all), len(users))
	}
}

func TestTeamLeaderCannotAccessConsumerProjectThroughTeamLink(t *testing.T) {
	leader := AdminUser{ID: "usr_leader", Role: "team_leader", TeamID: "team_a"}
	activeTeams := map[string]bool{"team_a": true}
	links := []ProjectTeam{{TeamID: "team_a", Role: "team_leader"}}

	consumer := Project{ID: consumerProjectID, TeamID: "team_a", Teams: links}
	if role := projectAccessRole(leader, consumer, nil, activeTeams); role != "" {
		t.Fatalf("consumer project must not be reachable through a team link, got role %q", role)
	}
	regular := Project{ID: "prj_team", TeamID: "team_a", Teams: links}
	if role := projectAccessRole(leader, regular, nil, activeTeams); role != "maintainer" {
		t.Fatalf("team project should stay reachable for its leader, got role %q", role)
	}
}
