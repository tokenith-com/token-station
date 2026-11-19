// A root-relative base resolves to the browser origin after static export.
const apiBaseURL = (process.env.NEXT_PUBLIC_TOKENHUB_API_BASE_URL?.trim() || "").replace(/\/+$/, "") || "/";

export type RuntimeConfig = {
  apiBaseURL: string;
};

export function readRuntimeConfig(): RuntimeConfig {
  return { apiBaseURL };
}
