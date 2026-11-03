import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';
import {openBackup,restoreDatabase} from './lib/backup.mjs';

// Never infer a restoration target from the application's production DATABASE_URL.
if(!process.env.RESTORE_DATABASE_URL || !process.argv[2])throw new Error('Set RESTORE_DATABASE_URL to an empty, separate migrated database and supply the encrypted file.');
const target=new URL(process.env.RESTORE_DATABASE_URL),source=new URL(process.env.DATABASE_URL);
if(target.hostname===source.hostname && target.port===source.port && target.pathname===source.pathname)throw new Error('Restoring over the running application database is forbidden.');
const data=openBackup(await fs.readFile(process.argv[2]),process.env.BOT_VAULT_KEY);
const client=new pg.Client({connectionString:target.href,connectionTimeoutMillis:10000});
try{await client.connect();console.log(JSON.stringify(await restoreDatabase(client,data)));}finally{await client.end();}
