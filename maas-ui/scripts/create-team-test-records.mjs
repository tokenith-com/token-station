// Persist isolated DCL fixtures through real APIs; gateway calls use the built-in mock adapter.
// Credentials and generated API keys remain in memory and are never printed or saved.
import { randomBytes } from "node:crypto";

const backendURL = process.env.TOKENHUB_SEED_BACKEND_URL?.replace(/\/+$/, "");
const marker = "dcl-team-test-data";
const teamID = "dcl-test-team", projectID = "dcl-test-project";
const providerID = "dcl-team-test-provider", modelName = "dcl-team-test-model";
const upstreamName = "dcl-team-test-upstream", routeID = "dcl-team-test-route";

async function run() {
  if (!backendURL) throw new Error("Set TOKENHUB_SEED_BACKEND_URL to the configured real backend URL.");
  const identity = process.env.TOKENHUB_SEED_IDENTITY, password = process.env.TOKENHUB_SEED_PASSWORD;
  if (!identity || !password) throw new Error("Missing administrator login environment variables.");
  let token;
  async function request(path, method = "GET", body) {
    const response = await fetch(`${backendURL}/api/admin${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${typeof payload.error === "string" ? payload.error : payload.error?.message || "Request failed"}`);
    return payload;
  }
  token = (await request("/auth/login", "POST", { identity, password })).token;
  if (!token || token.startsWith("tokenhub-mock:")) throw new Error("A real administrator session is required.");
  const list = async (path) => {
    const result = await request(path);
    if (!Array.isArray(result.data)) throw new Error(`Unexpected list response: ${path}`);
    return result.data;
  };
  const [users, teams, projects, providers, models, routes, memberships, keys] = await Promise.all([
    list("/users"), list("/resources/teams"), list("/projects"), list("/providers"),
    list("/models"), list("/routing-rules"), list("/resources/project-members"), list("/api-keys"),
  ]);
  const leader = users.find((item) => item.username === "dcl");
  if (!leader || leader.role !== "team_leader") throw new Error("Expected dcl team leader account.");
  if ((leader.team_id && leader.team_id !== teamID) || leader.team_ids?.some((id) => id !== teamID)) {
    throw new Error("dcl already belongs to another team; refusing to replace membership.");
  }
  const existingTeam = teams.find((item) => item.id === teamID);
  const existingProject = projects.find((item) => item.id === projectID);
  const existingProvider = providers.find((item) => item.id === providerID);
  const existingModel = models.find((item) => item.id === modelName || item.name === modelName);
  const existingRoute = routes.find((item) => item.id === routeID);
  if (existingTeam && existingTeam.fields?.source !== marker) throw new Error("Test team ID collision.");
  if (existingProject && (existingProject.team_id !== teamID || existingProject.owner_user_id !== leader.id)) throw new Error("Test project ID collision.");
  if (existingProvider && (existingProvider.type !== "mock" || existingProvider.name !== "DCL 测试模拟渠道")) throw new Error("Test provider ID collision.");
  if (existingModel && existingModel.metadata?.source !== marker) throw new Error("Test model ID collision.");
  if (existingRoute && (existingRoute.provider_id !== providerID || existingRoute.model_name !== modelName)) throw new Error("Test route ID collision.");
  for (let index = 1; index <= 3; index++) {
    const username = `dcl_team_test_0${index}`;
    const user = users.find((item) => item.username === username);
    if (user && user.team_id !== teamID) throw new Error(`Test username collision: ${username}`);
  }
  if (!existingTeam) await request("/resources/teams", "POST", {
    id: teamID, name: "DCL 测试团队", description: "团队页面联调测试数据", status: "active",
    fields: { owner: leader.id, source: marker },
  });
  if (leader.team_id !== teamID) await request(`/users/${leader.id}`, "PATCH", { team_id: teamID, team_ids: [teamID] });
  const members = [];
  for (let index = 1; index <= 3; index++) {
    const username = `dcl_team_test_0${index}`;
    let user = users.find((item) => item.username === username);
    if (!user) user = await request("/users", "POST", {
      username, name: `DCL 测试成员 ${index}`, email: `${username}@example.test`, role: "user",
      team_id: teamID, team_ids: [teamID], status: index === 3 ? "disabled" : "active",
      password: randomBytes(24).toString("base64url"),
    });
    if (!user.id) throw new Error(`Member creation returned no ID: ${username}`);
    members.push(user);
  }
  if (!existingProvider) await request("/providers", "POST", {
    id: providerID, name: "DCL 测试模拟渠道", type: "mock", base_url: "", status: "active",
    priority: 100, create_routes: false, selected_models: [], custom_models: [],
  });
  const inventory = await list(`/provider-models?provider_id=${providerID}`);
  if (!inventory.some((item) => item.provider_id === providerID && item.upstream_model === upstreamName)) {
    await request("/provider-models/import", "POST", { provider_id: providerID, publish: false, models: [{
      id: upstreamName, name: upstreamName, canonical_name: modelName, display_name: "DCL 测试上游模型",
      type: "chat", category: "custom", family: "custom", context_window: 4096,
      input_modalities: ["text"], output_modalities: ["text"], capabilities: ["chat"], metadata: { source: marker },
    }] });
  }
  if (!existingModel) await request("/models", "POST", {
    id: modelName, name: modelName, category: "custom", family: "custom", modality: "chat",
    context_window: 4096, status: "active", input_price_usd_per_1m: 0, output_price_usd_per_1m: 0,
    input_modalities: ["text"], output_modalities: ["text"], capabilities: ["chat"], routes: [],
    metadata: { source: marker, directory_role: "external", display_name: "DCL 测试模型（模拟）" },
  });
  if (!existingProject) await request("/projects", "POST", {
    id: projectID, name: "DCL 测试项目", owner_user_id: leader.id, team_id: teamID,
    teams: [{ team_id: teamID, role: "developer", is_primary: true }],
    model_access_mode: "restricted", allowed_models: [modelName], status: "active",
  });
  for (const user of members.slice(0, 2)) {
    if (!memberships.some((item) => item.fields?.project_id === projectID && item.fields?.user_id === user.id)) {
      await request("/resources/project-members", "POST", {
        id: `dcl-test-member-${user.username}`, name: user.name, status: "active",
        description: "DCL 测试项目成员", fields: { project_id: projectID, user_id: user.id, role: "developer", source: marker },
      });
    }
  }
  if (!existingRoute) await request("/routing-rules", "POST", {
    id: routeID, model_name: modelName, provider_id: providerID, provider_model: upstreamName,
    priority: 100, weight: 100, strategy: "balanced", status: "active", sticky_session: false,
    project_scope: "include", project_ids: [projectID], tags: ["dcl-test"],
  });
  let calls = 0;
  for (const [index, user] of [leader, ...members.slice(0, 2)].entries()) {
    const name = `DCL 页面测试 Key ${index + 1}`;
    // Secrets cannot be retrieved later. Preserve existing keys instead of rotating them on reruns.
    if (keys.some((item) => item.project_id === projectID && item.name === name)) continue;
    const key = await request(`/projects/${projectID}/keys`, "POST", {
      name, owner_user_id: user.id, group: "dcl-test", model_access_mode: "restricted", allowed_models: [modelName],
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      limits: { daily_requests: 20, monthly_requests: 20, daily_tokens: 10000, monthly_tokens: 10000, max_concurrency: 1 },
    });
    if (!key.api_key) throw new Error("Test key creation did not return a secret.");
    const response = await fetch(`${backendURL}/v1/chat/completions`, {
      method: "POST", headers: { authorization: `Bearer ${key.api_key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: modelName, messages: [{ role: "user", content: `DCL 团队页面测试请求 ${index + 1}` }], max_tokens: 64 }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Mock gateway call: ${response.status} ${result.error?.message || "Request failed"}`);
    if (!result.usage || !result.choices?.length) throw new Error("Mock gateway response did not contain usage and choices.");
    calls++;
  }
  console.log(JSON.stringify({ teamID, projectID, testMembers: members.length, modelName, mockRequestsCreated: calls, providerType: "mock" }));
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
