import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.js";
import { logger } from "../logger.js";

const { Pool, types } = pg;

// Telegram IDs caben holgadamente en Number.MAX_SAFE_INTEGER.
// pg devuelve BIGINT como string por defecto; lo convertimos a number.
types.setTypeParser(20, (value: string) => Number(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  logger.error({ err: error }, "Error inesperado en el pool de PostgreSQL");
});

const connection = new AsyncLocalStorage<{client: pg.PoolClient; depth: number}>();
export function withDatabaseConnection<T>(client: pg.PoolClient, run: () => Promise<T>): Promise<T> {
  return connection.getStore()?.client === client ? run() : connection.run({client, depth: 0}, run);
}
export async function withSessionLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const ambient = connection.getStore(), client = ambient?.client ?? await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    return await withDatabaseConnection(client, run);
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]); } finally { if (!ambient) client.release(); }
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return (connection.getStore()?.client ?? pool).query<T>(text, params as never[]);
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function many<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const ambient = connection.getStore(), client = ambient?.client ?? await pool.connect();
  const depth = ambient?.depth ?? 0, savepoint = `nested_${depth}`;
  try {
    await client.query(depth ? `SAVEPOINT ${savepoint}` : "BEGIN");
    const result = await connection.run({client, depth: depth + 1}, () => fn(client));
    await client.query(depth ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    await client.query(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}` : "ROLLBACK");
    throw error;
  } finally { if (!ambient) client.release(); }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
