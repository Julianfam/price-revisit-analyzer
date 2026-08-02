import { createMiddleware } from "@tanstack/react-start";

/**
 * Optional auth: attaches user when present, never throws Unauthorized.
 * Used for analyze/scalper gates (guests still allowed with client quota).
 */
export const optionalAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./client");
    const token = getBearerToken() ?? undefined;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      sendContext: { bearerToken: token },
    });
  })
  .server(async ({ next, context }) => {
    const { getSessionUser } = await import("./verify.server");
    let bearer = context.bearerToken as string | undefined;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      const h =
        req?.headers.get("authorization") ?? req?.headers.get("Authorization");
      if (h?.toLowerCase().startsWith("bearer ")) {
        bearer = h.slice(7).trim() || bearer;
      }
    } catch {
      /* no request */
    }

    const user = await getSessionUser(bearer);
    return next({
      context: {
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        userName: user?.name ?? null,
      },
    });
  });
