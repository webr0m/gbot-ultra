import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,describe,expect,it,vi} from 'vitest';
function harness(fetch:any){
 const document={addEventListener:vi.fn(),getElementById:()=>null,querySelectorAll:()=>[],documentElement:{dataset:{}},body:{classList:{add:vi.fn(),remove:vi.fn()}}};
 const window:any={location:{search:''}};
 runInNewContext(readFileSync(new URL('../public/core.js',import.meta.url),'utf8'),{window,document,URLSearchParams,URL,Intl,Date,setTimeout,clearTimeout,localStorage:{getItem:()=>null},AbortController,fetch});
 const G=window.GBot;G.state.initData='FAKE_SESSION';G.delay=vi.fn(async()=>{});G.showAuth=vi.fn();return G;
}
afterEach(()=>vi.useRealTimers());
describe('Mini App transient connection recovery',()=>{
 it('recovers proxy HTML errors with authenticated reads and bounded backoff',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('<html>525</html>',{status:525})).mockResolvedValueOnce(new Response('',{status:520})).mockResolvedValueOnce(Response.json({ok:true}));const G=harness(fetch);
  expect(await G.api.get('/api/chats')).toEqual({ok:true});expect(fetch).toHaveBeenCalledTimes(3);expect(G.delay).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[2][1]).toMatchObject({method:'GET',redirect:'error',credentials:'same-origin',headers:{'X-Telegram-Init-Data':'FAKE_SESSION'}});
 });
 it('recovers a reset while reading the response body',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce({ok:true,text:async()=>{throw new TypeError('reset')}}).mockResolvedValueOnce(Response.json({ok:true}));const G=harness(fetch);expect(await G.api.get('/api/chats')).toEqual({ok:true});expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('stops after three attempts when the proxy remains unavailable',async()=>{
  const fetch=vi.fn(async()=>new Response('upstream',{status:503})),G=harness(fetch);await expect(G.api.get('/api/chats')).rejects.toMatchObject({status:503});expect(fetch).toHaveBeenCalledTimes(3);
 });
 it.each([401,403,409,429,500])('does not replay an application or authorization error %i',async status=>{
  const fetch=vi.fn(async()=>Response.json({error:'denied'},{status})),G=harness(fetch);await expect(G.api.get('/api/chats')).rejects.toMatchObject({status});expect(fetch).toHaveBeenCalledOnce();expect(G.showAuth).toHaveBeenCalledTimes(status===401?1:0);
 });
 it.each(['post','patch','del'])('never replays a %s after a proxy error',async method=>{
  const fetch=vi.fn(async()=>new Response('uncertain',{status:525})),G=harness(fetch);await expect(G.api[method]('/api/moderation',{action:'test'})).rejects.toMatchObject({status:525});expect(fetch).toHaveBeenCalledOnce();
 });
 it('preserves an uncertain write network error as status zero without replaying it',async()=>{
  const fetch=vi.fn(async()=>{throw new TypeError('reset')}),G=harness(fetch);await expect(G.api.post('/api/settings',{})).rejects.toMatchObject({status:0});expect(fetch).toHaveBeenCalledOnce();
 });
 it('enforces the total deadline while the body stalls',async()=>{
  vi.useFakeTimers();const fetch=vi.fn(async(_path,opts)=>({ok:true,text:()=>new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'}))))}));const G=harness(fetch);const checked=expect(G.api.get('/api/chats')).rejects.toMatchObject({status:0});await vi.advanceTimersByTimeAsync(25001);await checked;expect(fetch).toHaveBeenCalledOnce();
 });
 it('uses the same recovery rules for read-only downloads',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new TypeError('reset')).mockResolvedValueOnce(new Response('export contents')),G=harness(fetch);expect(await (await G.api.blob('/api/export')).text()).toBe('export contents');expect(fetch).toHaveBeenCalledTimes(2);
 });
});
