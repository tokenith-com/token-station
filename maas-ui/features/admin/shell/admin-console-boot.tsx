import { AdminConsole } from "./admin-console";
import { readRuntimeConfig } from "@/lib/runtime-config";

// 静态部署没有服务端：后端地址在构建期固化，这里只做一次配置校验，
// 避免把请求静默发到不存在的相对路径 /api/backend。
export function AdminConsoleBoot() {
  const config = readRuntimeConfig();

  if (!config.apiBaseURL) {
    return (
      <main className="login-shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <p style={{ maxWidth: 620, lineHeight: 1.8 }}>
          构建时缺少 <code>NEXT_PUBLIC_TOKENHUB_API_BASE_URL</code>，请在 <code>.env.production</code> 中配置后端地址后重新构建：
          <br />
          <code>NEXT_PUBLIC_TOKENHUB_API_BASE_URL=https://hub.centlt.com npm run build</code>
        </p>
      </main>
    );
  }

  return <AdminConsole defaultBaseURL={config.apiBaseURL} portal={config.portal} captchaID={config.captchaID} />;
}