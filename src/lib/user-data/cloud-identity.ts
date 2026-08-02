/**
 * Stable cloud key so alerts follow the *person*, not a volatile user_id.
 */
export function normalizeIdentityPart(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@._+\-]+/g, "")
    .trim();
}

function isWeakEmail(email: string): boolean {
  const e = email.toLowerCase();
  return (
    e.endsWith(".local") ||
    e.endsWith("@localhost") ||
    e.includes("privaterelay") ||
    e.includes("users.noreply") ||
    e.endsWith("@x.com") || // synthetic from our tests / some oauth
    e.includes("+oauth") ||
    e.length < 5
  );
}

/**
 * Primary key for cloud blob.
 * Prefer real email, else display name / handle, else user id.
 */
export function accountCloudKey(user: {
  id: string;
  email?: string | null;
  name?: string | null;
}): string {
  const email = user.email?.trim().toLowerCase() ?? "";
  const name = normalizeIdentityPart(user.name ?? "");

  // Strong name first when email is synthetic (common with OAuth / multi-device)
  if (name.length >= 3 && (!email || isWeakEmail(email))) {
    return `n:${name.replace(/[\s._\-]+/g, "")}`;
  }

  if (email.includes("@") && !isWeakEmail(email)) {
    return `e:${email}`;
  }

  if (name.length >= 3) {
    return `n:${name.replace(/[\s._\-]+/g, "")}`;
  }

  return `u:${user.id}`;
}

/** All keys we read/write so siblings still meet. */
export function accountCloudKeyCandidates(user: {
  id: string;
  email?: string | null;
  name?: string | null;
}): string[] {
  const keys = new Set<string>();
  keys.add(accountCloudKey(user));
  keys.add(`u:${user.id}`);

  const email = user.email?.trim().toLowerCase() ?? "";
  if (email.includes("@") && !isWeakEmail(email)) {
    keys.add(`e:${email}`);
  }

  const name = normalizeIdentityPart(user.name ?? "");
  if (name.length >= 3) {
    keys.add(`n:${name}`);
    keys.add(`n:${name.replace(/[\s._\-]+/g, "")}`);
  }

  return [...keys];
}
