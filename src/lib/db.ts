/**
 * Embedded PGLite for live preview auth + app data.
 *
 * Assets (data/wasm/initdb) always loaded from absolute node_modules paths —
 * never via import.meta.url (/var/task/_libs → ENOENT).
 *
 * Disk dataDir is used so OAuth state + sessions survive Vite HMR mid-login
 * (memory-only wiped the DB between /api/oauth/start and the broker callback).
 */
export type DbSource = "neon" | "pglite";

const rawDatabaseUrl =
  typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
const databaseUrl =
  rawDatabaseUrl && rawDatabaseUrl.trim() ? rawDatabaseUrl : undefined;

export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";

export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
  __pgliteOpenLock__?: Promise<void>;
  __pgliteAssets__?: {
    data: Uint8Array;
    wasm: WebAssembly.Module;
    initdb: WebAssembly.Module;
  };
  __pgliteAssetsPromise__?: Promise<{
    data: Uint8Array;
    wasm: WebAssembly.Module;
    initdb: WebAssembly.Module;
  }>;
  __pgReadyPromise__?: Promise<void>;
};

const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

const DIST = "/workspace/node_modules/@electric-sql/pglite/dist";
const DATA_DIR = "/workspace/.data/pglite";

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1)
      text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ) => run<T>(text, params);
  return sql;
}

function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({ connectionString: databaseUrl });
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

function copyBytes(buf: Buffer): Uint8Array {
  const out = new Uint8Array(buf.byteLength);
  out.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadPgliteAssets(): Promise<{
  data: Uint8Array;
  wasm: WebAssembly.Module;
  initdb: WebAssembly.Module;
}> {
  if (globalRef.__pgliteAssets__) return globalRef.__pgliteAssets__;
  globalRef.__pgliteAssetsPromise__ ??= (async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { createRequire } = await import("node:module");

    let dist = DIST;
    if (!existsSync(join(dist, "pglite.data"))) {
      try {
        const req = createRequire(
          "/workspace/node_modules/@electric-sql/pglite/package.json",
        );
        const entry = req.resolve("@electric-sql/pglite");
        dist = join(entry, "..");
      } catch {
        dist = join(process.cwd(), "node_modules/@electric-sql/pglite/dist");
      }
    }

    const dataPath = join(dist, "pglite.data");
    const wasmPath = join(dist, "pglite.wasm");
    const initdbPath = join(dist, "initdb.wasm");

    for (const p of [dataPath, wasmPath, initdbPath]) {
      if (!existsSync(p)) throw new Error(`PGLite asset missing: ${p}`);
    }

    const data = copyBytes(readFileSync(dataPath));
    const wasmBuf = readFileSync(wasmPath);
    const initdbBuf = readFileSync(initdbPath);
    const [wasm, initdb] = await Promise.all([
      WebAssembly.compile(wasmBuf),
      WebAssembly.compile(initdbBuf),
    ]);

    const assets = { data, wasm, initdb };
    globalRef.__pgliteAssets__ = assets;
    console.info(
      "[db] PGLite assets ready",
      "data",
      data.byteLength,
      "from",
      dist,
    );
    return assets;
  })().catch((err) => {
    globalRef.__pgliteAssetsPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgliteAssetsPromise__;
}

async function ensureDataDir(): Promise<string | undefined> {
  if (process.env.PGLITE_MEMORY === "1") return undefined;
  try {
    const { mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(DATA_DIR, { recursive: true });
    const probe = join(DATA_DIR, ".write-probe");
    writeFileSync(probe, "ok");
    try {
      unlinkSync(probe);
    } catch {
      /* ignore */
    }
    return DATA_DIR;
  } catch (e) {
    console.warn("[db] disk dataDir unavailable, using memory", e);
    return undefined;
  }
}

async function openPgliteOnce(): Promise<
  import("@electric-sql/pglite").PGlite
> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { Buffer } = await import("node:buffer");
  const assets = await loadPgliteAssets();
  const dataDir = await ensureDataDir();

  const parsers = {
    [OID_INT8]: Number,
    [OID_DATE]: identity,
    [OID_INTERVAL]: identity,
  };

  const fsBundle = new Blob([Buffer.from(assets.data)]);
  const baseOpts = {
    parsers,
    fsBundle,
    pgliteWasmModule: assets.wasm,
    initdbWasmModule: assets.initdb,
  };

  // Prefer durable disk (survives HMR mid-OAuth). Fall back to memory.
  const attempts: Array<{ label: string; opts: Record<string, unknown> }> = [];
  if (dataDir) {
    attempts.push({
      label: `disk+assets:${dataDir}`,
      opts: { ...baseOpts, dataDir },
    });
  }
  attempts.push({ label: "memory+assets", opts: { ...baseOpts } });

  let lastErr: unknown;
  for (const a of attempts) {
    try {
      const pg = new PGlite(
        a.opts as ConstructorParameters<typeof PGlite>[0],
      );
      await pg.waitReady;
      await pg.query("select 1::int as n");
      await pg.exec(`
        create table if not exists _migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        );
      `);
      console.info("[db] PGLite ready:", a.label);
      return pg;
    } catch (err) {
      lastErr = err;
      console.warn(
        "[db] open failed:",
        a.label,
        err instanceof Error ? err.message : err,
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("PGLite failed all open attempts");
}

async function openPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  let release!: () => void;
  const prev = globalRef.__pgliteOpenLock__ ?? Promise.resolve();
  globalRef.__pgliteOpenLock__ = new Promise<void>((r) => {
    release = r;
  });
  await prev.catch(() => undefined);
  try {
    return await openPgliteOnce();
  } finally {
    release();
  }
}

async function createPgliteSql(): Promise<Sql> {
  // Single-flight open — never await __pgliteInstance__ inside openPglite
  // (self-await deadlock → permanent "database_warming").
  if (!globalRef.__pgliteInstance__) {
    globalRef.__pgliteInstance__ = openPglite().catch((err) => {
      globalRef.__pgliteInstance__ = undefined;
      throw err;
    });
  }
  const pg = await globalRef.__pgliteInstance__;

  const migrate = async (): Promise<void> => {
    // Ensure ledger exists (0001 also creates it, but we need it before reading)
    await pg.exec(`
      create table if not exists _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    // Prefer fs over import.meta.glob — glob is not always available in SSR
    // workers / HMR and caused: "(intermediate value).glob is not a function"
    // which broke listMyAlerts / cloud alert sync entirely.
    const { readdirSync, readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dirCandidates = [
      join(process.cwd(), "migrations"),
      "/workspace/migrations",
    ];
    let dir: string | null = null;
    for (const d of dirCandidates) {
      if (existsSync(d)) {
        dir = d;
        break;
      }
    }
    if (!dir) {
      console.warn("[db] no migrations directory found");
      return;
    }

    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    const doneRows = await pg.query<{ name: string }>(
      "select name from _migrations",
    );
    const done = new Set(doneRows.rows.map((r) => r.name));

    for (const name of files) {
      if (done.has(name)) continue;
      const text = readFileSync(join(dir, name), "utf8");
      try {
        await pg.transaction(async (tx) => {
          await tx.exec(text);
          await tx.query("insert into _migrations (name) values ($1)", [name]);
        });
        console.info("[db] migration applied:", name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already exists|duplicate/i.test(msg)) {
          await pg.query(
            "insert into _migrations (name) values ($1) on conflict do nothing",
            [name],
          );
          console.warn("[db] migration already applied:", name);
        } else {
          throw e;
        }
      }
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined)
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  return dbSource === "neon" ? createNeonSql() : createPgliteSql();
}

export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null;
    throw err;
  });
  return sqlPromise;
}

export async function getPglite(): Promise<
  import("@electric-sql/pglite").PGlite
> {
  if (dbSource !== "pglite") {
    throw new Error(
      "getPglite() is only available on the PGLite fallback (no DATABASE_URL)",
    );
  }
  await ensureDbReady();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  await pg.query("select 1");
  return pg;
}

export function resetDbForRetry(): void {
  globalRef.__pgSqlPromise__ = undefined;
  globalRef.__pgliteInstance__ = undefined;
  globalRef.__pgliteMigrateChain__ = undefined;
  globalRef.__pgReadyPromise__ = undefined;
  sqlPromise = null;
}

/**
 * Real multi-attempt warm-up. Resets poisoned singletons between tries.
 * Used by OAuth start/callback — not a cosmetic message.
 */
export async function ensureDbReady(opts?: {
  retries?: number;
  delayMs?: number;
}): Promise<void> {
  if (dbSource !== "pglite") return;

  const retries = opts?.retries ?? 5;
  const delayMs = opts?.delayMs ?? 250;

  // Coalesce concurrent waiters onto one warm promise, but only while healthy
  if (globalRef.__pgReadyPromise__) {
    try {
      await globalRef.__pgReadyPromise__;
      // live probe
      const pg = await globalRef.__pgliteInstance__;
      if (pg) {
        await pg.query("select 1");
        return;
      }
    } catch {
      resetDbForRetry();
    }
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const run = (async () => {
      await loadPgliteAssets();
      await getSql();
      const pg = await globalRef.__pgliteInstance__;
      if (!pg) throw new Error("no pglite instance");
      await pg.query("select 1 as ok");
    })();
    globalRef.__pgReadyPromise__ = run;
    try {
      await run;
      if (attempt > 1) {
        console.info("[db] ensureDbReady recovered on attempt", attempt);
      }
      return;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[db] ensureDbReady attempt ${attempt}/${retries} failed:`,
        err instanceof Error ? err.message : err,
      );
      resetDbForRetry();
      if (attempt < retries) await sleep(delayMs * attempt);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Database failed to start after retries");
}

export function isDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /enoent|pglite|no such file|database|ECONN|WASM|initdb/i.test(msg);
}

// Boot early so the first mobile OAuth request is warm
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (typeof window === "undefined" && dbSource === "pglite") {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady({ retries: 3 }).catch(
    (err) => {
      globalBoot.__pgBootstrapPromise__ = undefined;
      console.error("[db] PGLite bootstrap failed:", err);
    },
  );
}
