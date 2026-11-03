import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';

/** Single authenticated POST. Never replay or fall back after an uncertain result. */
export async function triggerSchedule({url,secret,originIp,caFile,timeoutMs=90000},transport={request:https.request,readFile,fetch:globalThis.fetch}) {
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password||!secret)throw new Error('Invalid scheduler HTTPS configuration');
  if(!originIp){
    const r=await transport.fetch(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'X-GBot-Cron-Secret':secret}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.text();
  }
  const family=isIP(originIp);
  if(!family||!caFile)throw new Error('Direct scheduler requires an IP and a trusted CA file');
  const ca=await transport.readFile(caFile,'utf8');
  return new Promise((resolve,reject)=>{
    const request=transport.request({protocol:'https:',hostname:target.hostname,servername:target.hostname,port:target.port||443,path:target.pathname+target.search,method:'POST',agent:false,ca,rejectUnauthorized:true,family,autoSelectFamily:false,
      lookup:(_hostname,_options,callback)=>callback(null,originIp,family),headers:{'X-GBot-Cron-Secret':secret}},response=>{
      let body='',bytes=0;
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)request.destroy(new Error('Scheduler response too large'));else body+=chunk;});
      response.on('error',reject);
      response.on('end',()=>{if(response.statusCode!==200)reject(new Error('HTTP '+response.statusCode));else resolve(body)});
    });
    const timer=setTimeout(()=>request.destroy(new Error('Scheduler timeout')),timeoutMs);
    request.on('close',()=>clearTimeout(timer));
    request.on('error',reject);
    request.end();
  });
}
