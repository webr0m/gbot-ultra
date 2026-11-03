import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import {automaticBackup,atomicJson,readJson} from './lib/backup.mjs';
import {advanceMonitor,webhookCheck,reusableWebhookObservation,schedulerCheck,alertText} from './lib/monitor.mjs';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
dotenv.config({path:path.join(appRoot,'.env'),quiet:true});
export async function monitorHosting({stateRoot=path.join(appRoot,'var')}={}) {
  const stateFile=path.join(stateRoot,'operations','monitor.json');
  const previous=await readJson(stateFile),checks={};let client,locked=false,backup=null;
  // A failed or slow web application must not prevent database backups or local monitoring.
  try {
    const response=await fetch(new URL('/api/health',process.env.WEBAPP_URL),{signal:AbortSignal.timeout(15000),redirect:'error'});
    const health=await response.json();checks.http={status:response.ok&&health.ok?'ok':'error'};
  }catch{checks.http={status:'error'};}
  try {
    client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,query_timeout:30000});
    client.on('error',()=>{});await client.connect();
    locked=(await client.query('SELECT pg_try_advisory_lock($1) AS locked',[749302613])).rows[0]?.locked;
    if(!locked){await client.end();return;} // Another hosting cron owns this observation.
    await client.query('SELECT 1');checks.database={status:'ok'};
    try{checks.scheduler=schedulerCheck((await client.query('SELECT name,completed_at,failed_at FROM scheduler_runs')).rows);}
    catch{checks.scheduler={status:'error'};}
    try{backup=await automaticBackup(client,stateRoot,process.env.BOT_VAULT_KEY);checks.backup={status:backup?.verifiedAt?'ok':'error'};}
    catch{checks.backup={status:'error'};}
  }catch{checks.database={status:'error'};checks.scheduler={status:'unknown'};checks.backup={status:'unknown'};}
  try {
    // Healthy metadata lasts ten minutes. Recheck failures on the next observation:
    // replaying a cached error must not confirm a second failure or delay recovery.
    const cached=previous?.webhookObserved;
    let observed=cached;
    if(!reusableWebhookObservation(cached)){
      try{
        const r=await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getWebhookInfo`,{signal:AbortSignal.timeout(15000),redirect:'error'});
        const body=await r.json();if(!r.ok||!body.ok)throw new Error('Webhook unavailable');
        observed={at:new Date().toISOString(),check:webhookCheck(body.result,new URL('/telegram/webhook',process.env.WEBHOOK_URL||process.env.WEBAPP_URL).href)};
      }catch{observed={at:new Date().toISOString(),check:{status:'error',reason:'unavailable'}};}
    }
    checks.webhook=observed.check;
    const state=advanceMonitor(previous,checks);state.webhookObserved=observed;
    state.backup=backup?{createdAt:backup.createdAt,verifiedAt:backup.verifiedAt,retained:backup.retained}:previous?.backup||null;
    const recipient=process.env.MONITOR_ALERT_CHAT_ID;
    state.notificationsEnabled=Boolean(recipient);
    state.notificationLanguage=previous?.notificationLanguage??'es';
    if(recipient&&checks.database.status==='ok'){
      try{const row=(await client.query("SELECT COALESCE(bot_language,language_code,'es') AS language FROM users WHERE user_id=$1",[recipient])).rows[0];if(row?.language)state.notificationLanguage=row.language;}catch{/* Preserve the last known private preference. */}
    }
    if(recipient && state.incidentStatus!==state.notifiedStatus &&
      (state.lastNotificationTarget!==state.incidentStatus || !state.lastNotificationAttempt || Date.now()-Date.parse(state.lastNotificationAttempt)>=30*60_000)) {
      // Persist the attempt before network I/O: a killed process cannot immediately flood the recipient.
      state.lastNotificationTarget=state.incidentStatus;state.lastNotificationAttempt=new Date().toISOString();await atomicJson(stateFile,state);
      try {
        let text=alertText(state);
        try{
          const {localizedOperationAlert}=await import('../dist/services/operations-alerts.js');
          text=localizedOperationAlert(state.incidentStatus==='healthy',state.failing,state.notificationLanguage);
        }catch{/* Monitoring keeps working while the application or database is unavailable. */}
        const response=await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:recipient,text,disable_notification:state.incidentStatus==='healthy'}),
        });
        const result=await response.json();if(!response.ok||!result.ok)throw new Error('Notification failed');
        state.notifiedStatus=state.incidentStatus;state.notifiedAt=new Date().toISOString();
        state.notificationFailed=false;
      }catch{state.notificationFailed=true;}
    }
    await atomicJson(stateFile,state);
    console.log(JSON.stringify({monitor:state.incidentStatus,checks:Object.fromEntries(Object.entries(checks).map(([n,c])=>[n,c.status])),backup:checks.backup.status}));
    return state;
  }finally{
    if(client){try{if(locked)await client.query('SELECT pg_advisory_unlock($1)',[749302613]);}finally{await client.end().catch(()=>{});}}
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{await monitorHosting();}catch{console.error(new Date().toISOString(),'Monitor could not finish; inspect hosting resources and private state.');process.exitCode=1;}
}
