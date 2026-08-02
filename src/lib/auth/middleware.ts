import { createMiddleware } from "@tanstack/react-start";

/**
 * Auth middleware for server functions — verified user id (+ identity fields for god-mode).
 *
 * Live preview: session cookies are partitioned, so the client stores a bearer
 * token and we forward it both as `Authorization` (request header) and via
 * `sendContext` (legacy path). Prefer the header so Better Auth's bearer plugin
 * sees the same shape as `/api/auth/get-session`.
 */
export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./client");
    const token = getBearerToken() ?? undefined;
    return next({
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : {},
      sendContext: { bearerToken: token },
    });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { requireUser } = await import("./verify.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    assertSameSiteRequest();

    // Prefer token from Authorization header (set by client middleware), then sendContext
    let bearer = context.bearerToken as string | undefined;
    try {
      const req = getRequest();
      const h = req?.headers.get("authorization") ?? req?.headers.get("Authorization");
      if (h?.toLowerCase().startsWith("bearer ")) {
        bearer = h.slice(7).trim() || bearer;
      }
    } catch {
      /* no request context */
    }

    const user = await requireUser(bearer);
    return next({
      context: {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
      },
    });
  });
