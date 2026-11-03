import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {describe,it,expect,vi} from 'vitest';
import {triggerSchedule} from '../scripts/lib/scheduler-http.mjs';
const settings={url:'https://gbot.example/api/internal/schedule',secret:'FAKE_CRON_SECRET',originIp:'127.0.0.1',caFile:'/private/origin-ca.pem',timeoutMs:1000};
function transport(status=200,error=null){
 const request=vi.fn((options,callback)=>{const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{if(error){req.emit('error',error);req.emit('close');return}const response=new PassThrough();response.statusCode=status;callback(response);response.end('{"ok":true}');response.on('end',()=>req.emit('close'));});req.destroy=e=>{req.emit('error',e);req.emit('close')};return req});return {request,readFile:vi.fn(async()=> 'FAKE_TRUSTED_CA'),fetch:vi.fn()};
}
describe('direct hosting scheduler',()=>{
 it('uses the configured origin IP with the public hostname, CA validation and the existing secret',async()=>{
  const t=transport();expect(await triggerSchedule(settings,t)).toBe('{"ok":true}');const o=t.request.mock.calls[0][0];expect(o).toMatchObject({hostname:'gbot.example',servername:'gbot.example',path:'/api/internal/schedule',method:'POST',ca:'FAKE_TRUSTED_CA',rejectUnauthorized:true,headers:{'X-GBot-Cron-Secret':'FAKE_CRON_SECRET'}});const resolved=vi.fn();o.lookup('gbot.example',{},resolved);expect(resolved).toHaveBeenCalledWith(null,'127.0.0.1',4);expect(t.fetch).not.toHaveBeenCalled();
 });
 it('never falls back to Cloudflare or repeats a POST after a connection reset',async()=>{
  const t=transport(200,Object.assign(new Error('reset'),{code:'ECONNRESET'}));await expect(triggerSchedule(settings,t)).rejects.toMatchObject({code:'ECONNRESET'});expect(t.request).toHaveBeenCalledOnce();expect(t.fetch).not.toHaveBeenCalled();
 });
 it('does not follow a redirect carrying the cron secret',async()=>{
  const t=transport(302);await expect(triggerSchedule(settings,t)).rejects.toThrow('HTTP 302');expect(t.request).toHaveBeenCalledOnce();expect(t.fetch).not.toHaveBeenCalled();
 });
 it.each([{url:'http://gbot.example/api/internal/schedule'},{originIp:'not-an-IP'},{caFile:''},{secret:''}])('refuses invalid direct transport before sending credentials %j',async patch=>{
  const t=transport();await expect(triggerSchedule({...settings,...patch},t)).rejects.toThrow();expect(t.request).not.toHaveBeenCalled();expect(t.fetch).not.toHaveBeenCalled();
 });
 it('keeps public HTTPS compatibility when no direct origin is configured',async()=>{
  const t=transport();t.fetch.mockResolvedValue(new Response('{"ok":true}'));expect(await triggerSchedule({...settings,originIp:''},t)).toBe('{"ok":true}');expect(t.request).not.toHaveBeenCalled();expect(t.fetch.mock.calls[0][1]).toMatchObject({method:'POST',redirect:'error'});
 });
});
