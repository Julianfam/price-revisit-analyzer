/**
 * Claim a handoff code created after X/Google login in another browser
 * (e.g. X in-app browser → paste code in Brave).
 *
 * POST { code: "123456" } → { token, userLabel }
 */
import { createFileRoute } from "@tanstack/react-router";
import { claimHandoff } from "@/lib/auth/handoff.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handlePost(request: Request): Promise<Response> {
  let body: { code?: string };
  try {
    body = (await request.json()) as { code?: string };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const code = String(body.code ?? "").trim();
  if (!code) return json({ error: "missing_code" }, 400);

  const entry = claimHandoff(code);
  if (!entry) {
    return json(
      {
        error: "invalid_or_expired",
        message: "Code invalid or expired. Sign in again and use the new code.",
      },
      404,
    );
  }
  return json({
    token: entry.token,
    userLabel: entry.userLabel,
  });
}

export const Route = createFileRoute("/api/oauth/claim")({
  server: {
    handlers: {
      POST: ({ request }) => handlePost(request),
    },
  },
});
