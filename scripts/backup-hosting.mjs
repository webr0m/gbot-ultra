import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

if (!process.argv[2]) throw new Error('Indica un archivo privado de destino.');
const destination = path.resolve(process.argv[2]);
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
const backup = { exportedAt: new Date().toISOString(), tables: {} };
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  for (const {tablename} of tables.rows) {
    const quoted = '"'+tablename.replaceAll('"','""')+'"';
    backup.tables[tablename] = (await client.query('SELECT * FROM '+quoted)).rows;
  }
  await client.query('COMMIT');
  await fs.writeFile(destination,JSON.stringify(backup),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({backupCreated:true,rows:Object.fromEntries(Object.entries(backup.tables).map(([table,rows])=>[table,rows.length]))}));
} finally { await client.end(); }
