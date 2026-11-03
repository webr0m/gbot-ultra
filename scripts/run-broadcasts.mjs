// Bounded, server-side queue worker. Run once per minute from the hosting cron.
import dotenv from 'dotenv';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');dotenv.config({path:path.join(root,'.env'),quiet:true});process.chdir(root);
const {processBroadcasts}=await import('../dist/services/broadcasts.js'),{closePool}=await import('../dist/db/pool.js');
try{console.log(JSON.stringify({at:new Date().toISOString(),...await processBroadcasts()}));}catch{console.error(JSON.stringify({at:new Date().toISOString(),broadcastWorker:'error'}));process.exitCode=1;}finally{await closePool();}
