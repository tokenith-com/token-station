import { useEffect, useState } from "react";
import { backendRequest } from "../core/api-client";
import type { LoginIdentityProvider } from "../core/types";

export function useLoginIdentityProviders(enabled: boolean, baseURL: string) {
  const [providers, setProviders] = useState<LoginIdentityProvider[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void backendRequest("/api/admin/auth/identity-providers", { signal: controller.signal })
      .then(async response => response.ok ? (await response.json() as { data?: LoginIdentityProvider[] }).data ?? [] : [])
      .then(providers => {
        if (!controller.signal.aborted) setProviders(providers);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProviders([]);
      });
    return () => controller.abort();
  }, [enabled, baseURL]);

  return enabled ? providers : [];
}
