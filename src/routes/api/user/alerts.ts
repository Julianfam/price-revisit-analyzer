/**
 * REST alert sync — identity-stable cloud (email/name + user id).
 * GET  /api/user/alerts
 * POST /api/user/alerts
 */
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import {
  alertsUsePostgresPrimary,
  listAlertsForAccount,
  saveAlertsForAccount,
  type AlertDTO,
} from "@/lib/user-data/alerts-repo.server";
import { accountCloudKey } from "@/lib/user-data/cloud-identity";

function bearerFrom(request: Request): string | null {
  const h =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (h?.toLowerCase().startsWith("bearer ")) {
    let t = h.slice(7).trim();
    if (t.includes(".")) {
      const raw = t.split(".")[0];
      if (raw && raw.length >= 16) t = raw;
    }
    if (t) return t;
  }
  return null;
}

async function requireUser(request: Request): Promise<{
  id: string;
  email: string | null;
  name: string | null;
} | null> {
  const headers = new Headers(request.headers);
  const bearer = bearerFrom(request);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) return null;
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    };
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleGet(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    const alerts = await listAlertsForAccount(user);
    return json({
      alerts,
      userId: user.id,
      accountKey: accountCloudKey(user),
      count: alerts.length,
      userLabel: user.name || user.email || user.id.slice(0, 8),
      backend: alertsUsePostgresPrimary() ? "postgres" : "pglite+files",
    });
  } catch (e) {
    console.error("[api/user/alerts GET]", e);
    return json(
      { error: e instanceof Error ? e.message : "list_failed" },
      500,
    );
  }
}

async function handlePost(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  let body: { alerts?: AlertDTO[]; allowEmpty?: boolean };
  try {
    body = (await request.json()) as {
      alerts?: AlertDTO[];
      allowEmpty?: boolean;
    };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const alerts = Array.isArray(body.alerts) ? body.alerts.slice(0, 120) : [];
  try {
    const result = await saveAlertsForAccount(
      user,
      alerts,
      Boolean(body.allowEmpty),
    );
    return json({
      ...result,
      userId: user.id,
      accountKey: result.accountKey,
    });
  } catch (e) {
    console.error("[api/user/alerts POST]", e);
    return json(
      { error: e instanceof Error ? e.message : "save_failed" },
      500,
    );
  }
}

export const Route = createFileRoute("/api/user/alerts")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
