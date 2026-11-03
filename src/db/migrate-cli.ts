import { runMigrations } from "./migrate.js";
import { closePool } from "./pool.js";
import { logger } from "../logger.js";

runMigrations()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "Error ejecutando migraciones");
    await closePool().catch(() => undefined);
    process.exit(1);
  });
