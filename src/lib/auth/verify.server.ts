import { getRequest } from "@tanstack/react-start/server";
import { auth, authConfigured } from "./server";

/**
 * Server-side session resolution (server-only).
 */

const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

export { authConfigured };

if (databaseConfigured && !authConfigured) {
  console.error(
    "[auth] DATABASE_URL is set but auth is disabled (VITE_AUTH_ENABLED=false) " +
      "— requireUserId() will reject every request (fail closed) rather than " +
      "share one dev user on a real database.",
  );
}

export const DEV_USER_ID = "dev-user";

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = {
  id: string;
  email: string | null;
  name: string | null;
};

/**
 * Resolve the signed-in user from the current request, or `null`.
 * Uses cookie session and/or Authorization: Bearer (live preview).
 */
export async function getSessionUser(
  bearerToken?: string,
): Promise<VerifiedUser | null> {
  if (!authConfigured) return null;
  const request = getRequest();
  if (!request) return null;

  let headers = new Headers(request.headers);

  // Explicit token wins; else keep any Authorization already on the request
  if (bearerToken?.trim()) {
    headers.set("Authorization", `Bearer ${bearerToken.trim()}`);
  }

  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) return null;
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    };
  } catch (e) {
    console.warn("[auth] getSession failed", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function requireUserId(bearerToken?: string): Promise<string> {
  if (!authConfigured) {
    if (databaseConfigured) {
      throw new Error(
        "Auth is disabled (VITE_AUTH_ENABLED=false) but DATABASE_URL is set — " +
          "refusing to fall back to the shared dev user against a real database.",
      );
    }
    return DEV_USER_ID;
  }
  const user = await getSessionUser(bearerToken);
  if (!user) throw new UnauthorizedError();
  return user.id;
}

export async function requireUser(
  bearerToken?: string,
): Promise<VerifiedUser> {
  if (!authConfigured) {
    if (databaseConfigured) {
      throw new Error(
        "Auth is disabled (VITE_AUTH_ENABLED=false) but DATABASE_URL is set.",
      );
    }
    return { id: DEV_USER_ID, email: "dev@example.com", name: "Dev User" };
  }
  const user = await getSessionUser(bearerToken);
  if (!user) throw new UnauthorizedError();
  return user;
}
