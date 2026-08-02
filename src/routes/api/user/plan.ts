/**
 * REST plan API — mobile-stable (no TanStack server-fn HMR issues).
 * GET  /api/user/plan           → current plan (auto-starts trial on first visit)
 * POST /api/user/plan {action}  → trial | consume
 */
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import {
  consumeAnalysisForUser,
  getPlanForUser,
  startTrialForUser,
} from "@/lib/billing/plan-repo.server";

function bearerFrom(request: Request): string | null {
  const h =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (h?.toLowerCase().startsWith("bearer ")) {
    const t = h.slice(7).trim();
    if (t) return t;
  }
  return null;
}

async function sessionUser(request: Request): Promise<{
  id: string;
  email: string | null;
  name: string | null;
} | null> {
  const headers = new Headers(request.headers);
  const bearer = bearerFrom(request);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) return null;
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
  const user = await sessionUser(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    const plan = await getPlanForUser({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
    return json(plan);
  } catch (e) {
    console.error("[api/user/plan GET]", e);
    return json(
      { error: e instanceof Error ? e.message : "plan_failed" },
      500,
    );
  }
}

async function handlePost(request: Request): Promise<Response> {
  const user = await sessionUser(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const action = body.action ?? "";
  const ctx = {
    userId: user.id,
    email: user.email,
    name: user.name,
  };
  try {
    if (action === "trial") {
      const res = await startTrialForUser(ctx);
      return json(res, res.ok ? 200 : 409);
    }
    if (action === "consume") {
      const res = await consumeAnalysisForUser(ctx);
      return json(res, res.ok ? 200 : 402);
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[api/user/plan POST]", e);
    return json(
      { error: e instanceof Error ? e.message : "plan_failed" },
      500,
    );
  }
}

export const Route = createFileRoute("/api/user/plan")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
