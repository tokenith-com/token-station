// Persist display records through the real backend API.
// No mock backend or browser-local records are used here.
// 静态部署没有 /api/backend 代理，必须设置 TOKENHUB_SEED_BACKEND_URL；
// 本地 next dev 可省略，回退到 TOKENHUB_SEED_FRONTEND_URL 的代理。
const frontendURL = (process.env.TOKENHUB_SEED_FRONTEND_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const apiURL = (process.env.TOKENHUB_SEED_BACKEND_URL || frontendURL).replace(/\/+$/, "");
const provider = {
  id: "dcl-display-provider", name: "世纪利通展示渠道", type: "openai_compatible",
  base_url: "https://api.openai.com/v1", status: "active", priority: 100,
  create_routes: false, selected_models: [], custom_models: [],
};
const model = {
  id: "dcl-display-model", name: "dcl-display-model", category: "custom", family: "custom",
  modality: "chat", context_window: 0, status: "active",
  input_price_usd_per_1m: 0, output_price_usd_per_1m: 0, cache_read_price_usd_per_1m: 0,
  input_modalities: ["text"], output_modalities: ["text"], capabilities: [], supported_parameters: [],
  metadata: { source: "dcl-display-record", directory_role: "external", display_name: "世纪利通展示模型" },
  routes: [],
};

async function run() {
  if (process.argv.includes("--preview")) {
    console.log(JSON.stringify({ apiURL, provider, model, modelFilter: "全部（默认）" }, null, 2));
    return;
  }
  let token = process.env.TOKENHUB_ADMIN_TOKEN?.trim();
  async function request(path, method = "GET", body) {
    const response = await fetch(`${apiURL}${path}`, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message || "接口调用失败";
      throw new Error(`${method} ${path}: ${response.status} ${message}`);
    }
    return payload;
  }
  if (!token) {
    const identity = process.env.TOKENHUB_SEED_IDENTITY, password = process.env.TOKENHUB_SEED_PASSWORD;
    if (!identity || !password) throw new Error("缺少真实登录凭据：设置 TOKENHUB_ADMIN_TOKEN，或 TOKENHUB_SEED_IDENTITY 和 TOKENHUB_SEED_PASSWORD。");
    const login = await request("/api/admin/auth/login", "POST", { identity, password });
    token = login.token;
  }
  if (typeof token !== "string" || !token || token.startsWith("tokenhub-mock:")) throw new Error("需要真实后端 Token，不能使用模拟会话。");
  await request("/api/admin/auth/me");
  const list = async (path) => {
    const payload = await request(path);
    if (!Array.isArray(payload.data)) throw new Error(`${path} 未返回 data 列表`);
    return payload.data;
  };
  // Check both lists before writing; never overwrite an existing same-ID record.
  const [providers, models] = await Promise.all([list("/api/admin/providers"), list("/api/admin/models")]);
  const existingProvider = providers.find((item) => item.id === provider.id);
  const existingModel = models.find((item) => item.name === model.name || item.id === model.id);
  if (existingProvider && existingProvider.name !== provider.name) throw new Error("展示渠道 ID 已被其他记录使用，未写入。");
  if (existingModel && existingModel.metadata?.source !== model.metadata.source) throw new Error("展示模型 ID 已被其他记录使用，未写入。");
  if (!existingProvider) {
    await request("/api/admin/providers", "POST", provider);
    console.log(`已创建渠道：${provider.name} (${provider.id})`);
  }
  if (!existingModel) {
    await request("/api/admin/models", "POST", model);
    console.log(`已创建模型：${model.name}`);
  }
  const [savedProviders, savedModels] = await Promise.all([list("/api/admin/providers"), list("/api/admin/models")]);
  if (!savedProviders.some((item) => item.id === provider.id) || !savedModels.some((item) => item.name === model.name)) {
    throw new Error("创建后回读未找到完整记录，请检查后端；脚本不会自动删除已创建的数据。");
  }
  console.log("后端回读已确认。刷新 /providers 和 /models 默认列表即可查看展示记录。");
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
