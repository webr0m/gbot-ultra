import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const quote = name => '"' + name.replaceAll('"','""') + '"';
const MAX_BYTES = 256 * 1024 * 1024;
function key(secret) {
  const raw = Buffer.from(secret || '', 'base64');
  if (raw.length !== 32) throw new Error('Backup encryption key is not configured');
  return Buffer.from(hkdfSync('sha256',raw,'GBot','database-backup-v1',32));
}
export function sealBackup(snapshot, secret) {
  const data = Buffer.from(JSON.stringify(snapshot));
  if (data.length > MAX_BYTES) throw new Error('Backup exceeds memory budget');
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key(secret),nonce);
  cipher.setAAD(Buffer.from('GBB1'));
  const encrypted = Buffer.concat([cipher.update(gzipSync(data)),cipher.final()]);
  return Buffer.concat([Buffer.from('GBB1'),nonce,cipher.getAuthTag(),encrypted]);
}
export function openBackup(data, secret) {
  if (data.length < 33 || data.length > MAX_BYTES || data.subarray(0,4).toString() !== 'GBB1') throw new Error('Invalid backup file');
  const cipher = createDecipheriv('aes-256-gcm',key(secret),data.subarray(4,16));
  cipher.setAAD(Buffer.from('GBB1')); cipher.setAuthTag(data.subarray(16,32));
  const plain = gunzipSync(Buffer.concat([cipher.update(data.subarray(32)),cipher.final()]),{maxOutputLength:MAX_BYTES});
  const result = JSON.parse(plain.toString());
  if (result.format !== 1 || !result.tables || !Array.isArray(result.migrations)) throw new Error('Invalid backup schema');
  return result;
}
export async function snapshotDatabase(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const snapshot = {format:1, exportedAt:new Date().toISOString(), tables:{}, dependencies:[], sequences:[], migrations:[]};
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    for (const {tablename} of tables) {
      // Store raw JSON text: timestamps keep PostgreSQL microseconds and bigint values keep their exact digits.
      const rows = await client.query('SELECT row_to_json(t)::text AS value FROM public.'+quote(tablename)+' t');
      snapshot.tables[tablename] = rows.rows.map(r=>r.value);
    }
    snapshot.dependencies = (await client.query(`SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint c
      JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace n ON n.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=c.confrelid WHERE c.contype='f' AND n.nspname='public'`)).rows;
    const serials = (await client.query(`SELECT table_name,column_name,pg_get_serial_sequence(quote_ident(table_schema)||'.'||quote_ident(table_name),column_name) AS sequence
      FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'`)).rows;
    for (const row of serials) {
      if (!row.sequence) continue;
      const state = (await client.query('SELECT last_value::text,is_called FROM '+row.sequence)).rows[0];
      snapshot.sequences.push({...row,...state});
    }
    snapshot.migrations = (await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version);
    await client.query('COMMIT');
    return snapshot;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp = file+'.'+randomBytes(6).toString('hex')+'.tmp';
  try { await fs.writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'}); await fs.rename(temp,file); }
  finally { await fs.rm(temp,{force:true}); }
}
export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch(error) { if(error.code==='ENOENT') return null; throw error; }
}
export async function automaticBackup(client, root, secret, now=Date.now()) {
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked',[749302612])).rows[0]?.locked;
    if (!locked) return {skipped:true};
    const dir = path.join(root,'backups'), statusFile=path.join(root,'operations','backup.json');
    await fs.mkdir(dir,{recursive:true,mode:0o700}); await fs.chmod(dir,0o700);
    const previous = await readJson(statusFile);
    const schemaVersion=(await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version).join('|');
    if (previous?.schemaVersion===schemaVersion && previous?.file && /^gbot-[\dT-]+Z\.gbb$/.test(previous.file) && now-Date.parse(previous.createdAt)<86_400_000) {
      try {
        const data=await fs.readFile(path.join(dir,previous.file));
        if(createHash('sha256').update(data).digest('hex')===previous.sha256)return previous;
      } catch(error) { if(error.code!=='ENOENT')throw error; }
      // A missing or changed snapshot is replaced before the panel can report it as verified.
    }
    const snapshot = await snapshotDatabase(client), data = sealBackup(snapshot,secret);
    const name = 'gbot-'+new Date(now).toISOString().replaceAll(':','-').replace(/\.\d{3}Z$/,'Z')+'.gbb';
    const file = path.join(dir,name), temp = file+'.tmp';
    try {
      await fs.writeFile(temp,data,{flag:'wx',mode:0o600});
      const verified = openBackup(await fs.readFile(temp),secret);
      if (verified.exportedAt !== snapshot.exportedAt) throw new Error('Backup verification failed');
      await fs.rename(temp,file);
    } finally { await fs.rm(temp,{force:true}); }
    const names = (await fs.readdir(dir)).filter(n=>/^gbot-[\dT-]+Z\.gbb$/.test(n)).sort().reverse();
    // Delete only our own snapshots, after the new one has passed authenticated decryption.
    for (const old of names.slice(14)) await fs.unlink(path.join(dir,old));
    const result = {createdAt:new Date(now).toISOString(),verifiedAt:new Date().toISOString(),file:name,schemaVersion,
      sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,retained:Math.min(names.length,14),
      tables:Object.keys(snapshot.tables).length,rows:Object.values(snapshot.tables).reduce((n,rows)=>n+rows.length,0)};
    await atomicJson(statusFile,result);
    return result;
  } finally { if(locked)await client.query('SELECT pg_advisory_unlock($1)',[749302612]); }
}

/** Refuses live data. The caller must explicitly choose a separate, already migrated database. */
export async function restoreDatabase(client, snapshot) {
  await client.query('BEGIN');
  try {
    const available = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
    const expected = Object.keys(snapshot.tables).sort();
    if (JSON.stringify(available)!==JSON.stringify(expected)) throw new Error('Destination schema does not match backup');
    const migrations = (await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version);
    if (JSON.stringify(migrations)!==JSON.stringify(snapshot.migrations)) throw new Error('Migration versions do not match backup');
    // Transactional table locks close the gap between the empty check and inserts.
    await client.query('LOCK TABLE '+available.map(t=>'public.'+quote(t)).join(',')+' IN ACCESS EXCLUSIVE MODE');
    for (const name of available.filter(n=>n!=='schema_migrations')) {
      if ((await client.query('SELECT 1 FROM public.'+quote(name)+' LIMIT 1')).rowCount) throw new Error('Destination contains data; restoration refused');
    }
    const pending = new Set(available), ordered=[];
    while(pending.size) {
      const ready = [...pending].filter(n=>!snapshot.dependencies.some(d=>d.child===n && pending.has(d.parent)));
      if(!ready.length)throw new Error('Cyclic backup dependencies require manual restoration');
      for(const n of ready){pending.delete(n);ordered.push(n);}
    }
    await client.query('DELETE FROM schema_migrations');
    for (const name of ordered) {
      const rows = snapshot.tables[name];
      for(let i=0;i<rows.length;i+=250)await client.query('INSERT INTO public.'+quote(name)+' SELECT * FROM json_populate_recordset(NULL::public.'+quote(name)+',$1::json)',['['+rows.slice(i,i+250).join(',')+']']);
      const count = (await client.query('SELECT count(*)::text AS total FROM public.'+quote(name))).rows[0].total;
      if (count !== String(rows.length)) throw new Error('Restored row count mismatch');
    }
    for(const sequence of snapshot.sequences) {
      const actual = (await client.query('SELECT pg_get_serial_sequence($1,$2) AS name',['public.'+quote(sequence.table_name),sequence.column_name])).rows[0].name;
      if(!actual)throw new Error('Missing destination sequence');
      await client.query('SELECT setval($1::regclass,$2::bigint,$3::boolean)',[actual,sequence.last_value,sequence.is_called]);
    }
    await client.query('COMMIT');
    return {restored:true,tables:ordered.length,rows:Object.values(snapshot.tables).reduce((n,rows)=>n+rows.length,0)};
  } catch(error) { await client.query('ROLLBACK');throw error; }
}
