import { describe,it,expect,vi,afterEach } from 'vitest';
const m=vi.hoisted(()=>({one:vi.fn(),query:vi.fn()}));
vi.mock('../src/config.js',()=>({config:{ownerIds:new Set([900000001]),casEnabled:true,casApiKey:'qa-not-a-real-key'}}));
vi.mock('../src/db/pool.js',()=>({one:m.one,query:m.query}));
vi.mock('../src/logger.js',()=>({logger:{warn:vi.fn()}}));
import { parseCasResponse,checkCas,invalidateCas } from '../src/services/cas.js';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('CAS integration for every plan',()=>{
 it('distinguishes a positive record from no record, auth errors and malformed data',()=>{expect(parseCasResponse(200,{ok:true,result:{offenses:3}})).toBe('banned');expect(parseCasResponse(200,{ok:false,description:'Record not found.'})).toBe('clear');expect(parseCasResponse(401,{ok:false,description:'Unauthorized'})).toBe('unavailable');expect(parseCasResponse(200,{ok:true,result:{}})).toBe('unavailable');expect(parseCasResponse(500,{ok:true,result:{offenses:3}})).toBe('unavailable');});
 it('never queries or sanctions the permanent Developer role',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect((await checkCas(900000001)).status).toBe('exempt');expect(fetch).not.toHaveBeenCalled();expect(m.one).not.toHaveBeenCalled();});
 it('uses Bearer authentication and coalesces simultaneous checks across groups',async()=>{m.one.mockResolvedValue(null);m.query.mockResolvedValue({});const fetch=vi.fn(async()=>({status:200,json:async()=>({ok:true,result:{offenses:2}})}));vi.stubGlobal('fetch',fetch);const result=await Promise.all([checkCas(9101),checkCas(9101),checkCas(9101)]);expect(result.every(x=>x.status==='banned')).toBe(true);expect(fetch).toHaveBeenCalledOnce();const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).not.toContain('qa-not-a-real-key');expect(options.headers).toEqual({Authorization:'Bearer qa-not-a-real-key'});await checkCas(9101);expect(fetch).toHaveBeenCalledOnce();});
 it('honors a local CAS exception before calling the provider',async()=>{m.one.mockResolvedValue({exists:true});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect((await checkCas(9102)).status).toBe('exempt');expect(fetch).not.toHaveBeenCalled();});
 it('treats an outage as unavailable and never persists it as a clean or banned record',async()=>{m.one.mockResolvedValue(null);const fetch=vi.fn(async()=>{throw new Error('offline');});vi.stubGlobal('fetch',fetch);expect((await checkCas(9103)).status).toBe('unavailable');expect(m.query).not.toHaveBeenCalled();expect((await checkCas(9104)).status).toBe('unavailable');expect(fetch).toHaveBeenCalledOnce();});
});
