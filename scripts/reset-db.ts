import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

async function main() {
  const tables = [
    "payments",
    "boosts",
    "join_requests",
    "moderation_log",
    "warnings",
    "blacklist",
    "notes",
    "custom_commands",
    "chat_stats_daily",
    "chat_members",
    "chats",
    "users",
  ];
  for (const table of tables) {
    await pool.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
  }
  await migrate();
  console.log("Base de datos reiniciada.");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});