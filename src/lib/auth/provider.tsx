import { useEffect, type ReactNode } from "react";
import { captureSessionBearer, getBearerToken } from "@/lib/auth/client";
import { authClient } from "@/lib/auth/client";

/**
 * App-wide client provider. Restores bearer session ASAP on reload so
 * Free/guest UI doesn't flash for signed-in users.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!getBearerToken()) return;
    let cancelled = false;
    void (async () => {
      try {
        await captureSessionBearer();
        if (!cancelled) await authClient.getSession();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
