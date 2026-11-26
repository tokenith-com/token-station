import { tx } from "../i18n/runtime";

export type RequestErrorDetail = {
  message?: string;
  stage?: string;
  before_upstream?: boolean;
} | null | undefined;

// This bounded diagnosis remains available even when body access is forbidden.
export function RequestErrorSummary({ code, detail }: { code: string; detail: RequestErrorDetail }) {
  return (
    <div className="request-error-box" role="alert">
      <strong>{code}</strong>
      {detail?.stage ? <p>{tx("错误阶段")}：<code>{detail.stage}</code></p> : null}
      {detail?.before_upstream ? <p>{tx("请求在路由检查阶段被拒绝，尚未发送到上游。")}</p> : null}
      {detail?.message && detail.message !== code ? <p>{detail.message}</p> : null}
    </div>
  );
}
