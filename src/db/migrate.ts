import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool, withTransaction } from "./pool.js";
import { logger } from "../logger.js";

const migrationsDir = path.join(process.cwd(), "db", "migrations");

export async function runMigrations(): Promise<void> {
  const migrationLock=await pool.connect();
  await migrationLock.query('SELECT pg_advisory_lock($1)',[749302611]);
  try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const applied = new Set(
    (
      await pool.query<{ version: string }>("SELECT version FROM schema_migrations")
    ).rows.map((row) => row.version),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    });
    logger.info({ migration: file }, "Migración aplicada");
  }

  logger.info("Base de datos lista");
  } finally {
    try { await migrationLock.query('SELECT pg_advisory_unlock($1)',[749302611]); }
    finally { migrationLock.release(); }
  }
}
