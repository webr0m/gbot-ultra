import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const input = path.resolve(process.argv[2] || '../gbot-transfer/database.json');
const backup = JSON.parse(await fs.readFile(input,'utf8'));
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  await client.query('BEGIN');
  const existing = await client.query('SELECT COUNT(*)::int AS n FROM chats');
  if (existing.rows[0].n !== 0) throw new Error('Destination is not empty; import aborted.');
  for (const [table, rows] of Object.entries(backup.tables)) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid table name');
    for (const row of rows) {
      const keys = Object.keys(row);
      if (!keys.every(key=>/^[a-z_]+$/.test(key))) throw new Error('Invalid column name');
      const values = keys.map(key=>row[key]);
      await client.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,values);
    }
    if (['warnings','moderation_log','payments'].includes(table)) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE((SELECT MAX(id) FROM ${table}),1),(SELECT COUNT(*)>0 FROM ${table}))`);
    }
    const count = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    if (count.rows[0].n !== rows.length) throw new Error(`Row count mismatch: ${table}`);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({imported:true,rows:Object.fromEntries(Object.entries(backup.tables).map(([name,rows])=>[name,rows.length]))}));
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
