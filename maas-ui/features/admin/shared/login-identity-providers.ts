import { useEffect, useState } from "react";
import { backendRequest } from "../core/api-client";
import type { LoginIdentityProvider } from "../core/types";

export function useLoginIdentityProviders(enabled: boolean) {
  const [providers, setProviders] = useState<LoginIdentityProvider[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await backendRequest("/api/admin/auth/identity-providers");
        const payload = response.ok ? await response.json() as { data?: LoginIdentityProvider[] } : {};
        if (!cancelled) setProviders(payload.data ?? []);
      } catch {
        if (!cancelled) setProviders([]);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [enabled]);
  return enabled ? providers : [];
}
