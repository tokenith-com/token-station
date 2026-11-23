import { tx } from "../i18n/runtime";

export type RequestErrorDetail = {
  message?: string;
  before_upstream?: boolean;
} | null | undefined;

// The backend parses the stored response body and sends only this diagnosis, so
// the console never receives prompt or completion content.
export function RequestErrorSummary({ code, detail }: { code: string; detail: RequestErrorDetail }) {
  return (
    <div className="request-error-box" role="alert">
      <strong>{code}</strong>
      {detail?.before_upstream ? <p>{tx("请求在路由检查阶段被拒绝，尚未发送到上游。")}</p> : null}
      {detail?.message && detail.message !== code ? <p>{detail.message}</p> : null}
    </div>
  );
}
