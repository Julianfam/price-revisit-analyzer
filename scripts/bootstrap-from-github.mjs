/**
 * Vercel build bootstrap: pull full source from public GitHub repo.
 * Allows tiny MCP deploys while keeping the real app on GitHub.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = "https://codeload.github.com/Julianfam/price-revisit-analyzer/tar.gz/main";

if (existsSync("src/routes/index.tsx") && existsSync("vite.config.ts")) {
  console.log("[bootstrap] source already present — skip");
  process.exit(0);
}

const tmp = "/tmp/pra-src";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

console.log("[bootstrap] downloading", REPO);
execSync(`curl -fsSL "${REPO}" | tar -xz -C "${tmp}" --strip-components=1`, {
  stdio: "inherit",
});

// Copy everything except node_modules / .git / .vercel
const skip = new Set(["node_modules", ".git", ".vercel", ".data"]);
for (const name of readdirSync(tmp)) {
  if (skip.has(name)) continue;
  // Don't overwrite package.json we already installed from
  if (name === "package.json") continue;
  if (name === "package-lock.json") continue;
  const from = join(tmp, name);
  const to = join(process.cwd(), name);
  cpSync(from, to, { recursive: true, force: true });
  console.log("[bootstrap] restored", name);
}

if (!existsSync("src/routes/index.tsx")) {
  console.error("[bootstrap] failed — src missing after extract");
  process.exit(1);
}
console.log("[bootstrap] done");
