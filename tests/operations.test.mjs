import {describe,it,expect} from 'vitest';
import {advanceMonitor,schedulerCheck,webhookCheck,reusableWebhookObservation,TASK_INTERVALS,alertText} from '../scripts/lib/monitor.mjs';
import {sealBackup,openBackup} from '../scripts/lib/backup.mjs';

const secret=Buffer.alloc(32,7).toString('base64');
const healthy=()=>Object.fromEntries(['http','database','webhook','scheduler','backup'].map(n=>[n,{status:'ok'}]));
describe('hosting incident monitoring',()=>{
  it('rechecks a failed Telegram observation before confirming an incident or recovery',()=>{
    const now=Date.now(),at=new Date(now-300000).toISOString();
    const failed={at,check:{status:'error',reason:'delivery'}};
    expect(reusableWebhookObservation(failed,now)).toBe(false);
    let state=advanceMonitor(null,{...healthy(),webhook:failed.check},now-300000);
    const fresh=webhookCheck({url:'https://example.test/telegram/webhook',pending_update_count:0},'https://example.test/telegram/webhook',now);
    state=advanceMonitor(state,{...healthy(),webhook:fresh},now);
    expect(state.incidentStatus).toBe('healthy');
    expect(state.incidents).toHaveLength(0);
    expect(reusableWebhookObservation({at,check:fresh},now)).toBe(true);
    expect(reusableWebhookObservation({at:new Date(now-600000).toISOString(),check:fresh},now)).toBe(false);
    expect(reusableWebhookObservation({at:'invalid',check:fresh},now)).toBe(false);
    expect(reusableWebhookObservation({at:new Date(now+1).toISOString(),check:fresh},now)).toBe(false);
  });
  it('confirms failure and recovery after two observations, without repeat incidents',()=>{
    const bad={...healthy(),http:{status:'error'}};
    let state=advanceMonitor(null,healthy());expect(state.incidents).toHaveLength(0);
    state=advanceMonitor(state,bad);expect(state.incidentStatus).toBe('healthy');
    state=advanceMonitor(state,bad);expect(state.incidentStatus).toBe('degraded');expect(state.incidents).toHaveLength(1);
    expect(alertText(state)).toContain('Mini App');
    for(let i=0;i<10;i++)state=advanceMonitor(state,bad);
    expect(state.incidents).toHaveLength(1);
    state=advanceMonitor(state,healthy());expect(state.incidentStatus).toBe('degraded');
    state=advanceMonitor(state,healthy());expect(state.incidentStatus).toBe('healthy');expect(state.incidents).toHaveLength(2);
  });
  it('detects missing, failed and overdue tasks with hosting cron tolerance',()=>{
    const now=Date.now(),rows=Object.keys(TASK_INTERVALS).map(name=>({name,completed_at:new Date(now-300000),failed_at:null}));
    expect(schedulerCheck(rows,now).status).toBe('ok');
    expect(schedulerCheck(rows.slice(1),now).overdue).toEqual(['captcha-expiry']);
    rows[0].failed_at=new Date(now);expect(schedulerCheck(rows,now).status).toBe('error');
    rows[0].failed_at=null;rows[0].completed_at=new Date(now-15*60000);expect(schedulerCheck(rows,now).status).toBe('error');
  });
  it('ignores historical Telegram errors and detects live delivery problems',()=>{
    const now=Date.now(),url='https://example.test/telegram/webhook';
    expect(webhookCheck({url,pending_update_count:0,last_error_date:Math.floor(now/1000)-100},url,now).status).toBe('ok');
    expect(webhookCheck({url,pending_update_count:1,last_error_date:Math.floor(now/1000)-100},url,now).status).toBe('error');
    expect(webhookCheck({url:'https://wrong.test',pending_update_count:0},url).reason).toBe('destination');
  });
});
describe('encrypted snapshots',()=>{
  const snapshot={format:1,exportedAt:new Date().toISOString(),migrations:['001.sql'],tables:{users:['{"id":9007199254740993123,"date":"2026-11-03T00:00:00.123456Z"}']}};
  it('preserves raw JSON precision, authenticates content and uses a fresh nonce',()=>{
    const data=sealBackup(snapshot,secret);
    expect(openBackup(data,secret)).toEqual(snapshot);
    expect(data.equals(sealBackup(snapshot,secret))).toBe(false);
    data[data.length-1]^=1;expect(()=>openBackup(data,secret)).toThrow();
  });
  it('refuses a wrong or absent key and unencrypted input',()=>{
    const data=sealBackup(snapshot,secret);
    expect(()=>openBackup(data,Buffer.alloc(32,9).toString('base64'))).toThrow();
    expect(()=>sealBackup(snapshot,'')).toThrow();
    expect(()=>openBackup(Buffer.from(JSON.stringify(snapshot)),secret)).toThrow();
  });
});
