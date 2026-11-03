import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
const mocks=vi.hoisted(()=>({photos:vi.fn(),file:vi.fn(),chat:vi.fn(),download:vi.fn(),read:vi.fn(),runtime:vi.fn()}));
vi.mock('../src/config.js',()=>({config:{botToken:'123456789:FAKE_TEST_TOKEN_NO_EXTERNAL_CALLS',botMode:'off',schedulerMode:'interval',nodeEnv:'test',isProduction:true,ownerIds:new Set(),logLevel:'silent',databaseUrl:''},telegramFileUrl:(path:string,token:string)=>'https://api.telegram.org/file/'+token+'/'+path}));
vi.mock('../src/services/branded-bots.js',async original=>({...await original<Record<string,unknown>>(),runtimeForChat:mocks.runtime}));
vi.mock('../src/db/pool.js',()=>({one:mocks.read,many:vi.fn(),query:vi.fn(),withTransaction:vi.fn()}));
import { buildServer } from '../src/server/app.js';
import { avatarToken } from '../src/server/auth.js';
import { rememberBotToken } from '../src/services/bot-runtime.js';
let app:FastifyInstance;
beforeEach(async()=>{
 vi.clearAllMocks();mocks.read.mockResolvedValue(null);
 mocks.runtime.mockResolvedValue(null);
 mocks.photos.mockResolvedValue({total_count:1,photos:[[{file_id:'small-file'},{file_id:'large-file'}]]});
 mocks.file.mockResolvedValue({file_path:'photos/small.jpg',file_size:4});
 mocks.chat.mockResolvedValue({id:-88101,type:'supergroup',title:'QA',photo:{small_file_id:'group-small',big_file_id:'group-large'}});
 mocks.download.mockImplementation(async()=>new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}}));vi.stubGlobal('fetch',mocks.download);
 app=await buildServer({api:{getUserProfilePhotos:mocks.photos,getFile:mocks.file,getChat:mocks.chat},botInfo:{id:123456789,username:'qa_bot'}} as never);
});
afterEach(async()=>{await app.close();vi.unstubAllGlobals();});
function path(userId:number,chatId=-88101,ttl=3600){return '/api/avatar/'+userId+'?chat_id='+chatId+'&t='+encodeURIComponent(avatarToken(chatId,userId,ttl));}
describe('signed Mini App images',()=>{
 it('loads a signed image without the session header that img tags cannot provide',async()=>{const r=await app.inject(path(810001));expect(r.statusCode).toBe(200);expect(r.headers['content-type']).toContain('image/jpeg');expect(r.rawPayload).toEqual(Buffer.from([255,216,255,217]));expect(r.headers['cache-control']).toContain('private');expect(mocks.file).toHaveBeenCalledWith('small-file');});
 it('rejects unsigned, expired and modified capabilities before accessing Telegram',async()=>{for(const p of ['/api/avatar/810002?chat_id=-88101&t=bad',path(810002,-88101,-2),path(810002).replace('/810002?','/810003?')])expect((await app.inject(p)).statusCode).toBe(403);expect(mocks.photos).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();});
 it('keeps normal API calls authenticated',async()=>expect((await app.inject('/api/bootstrap?chat_id=-88101')).statusCode).toBe(401));
 it('loads the small group photo using getChat rather than the user-photo API',async()=>{const r=await app.inject(path(-88101));expect(r.statusCode).toBe(200);expect(mocks.chat).toHaveBeenCalledWith(-88101);expect(mocks.file).toHaveBeenCalledWith('group-small');expect(mocks.photos).not.toHaveBeenCalled();});
 it('does not allow a group image capability to target another group',async()=>{expect((await app.inject(path(-88103,-88104))).statusCode).toBe(403);expect(mocks.chat).not.toHaveBeenCalled();});
 it('coalesces concurrent downloads and then serves the memory cache',async()=>{const p=path(810004);const results=await Promise.all([app.inject(p),app.inject(p),app.inject(p)]);expect(results.every(r=>r.statusCode===200)).toBe(true);await app.inject(p);expect(mocks.photos).toHaveBeenCalledTimes(1);expect(mocks.file).toHaveBeenCalledTimes(1);expect(mocks.download).toHaveBeenCalledTimes(1);});
 it('returns a non-cached fallback when Telegram hides a photo',async()=>{mocks.photos.mockResolvedValue({total_count:0,photos:[]});const r=await app.inject(path(810005));expect(r.statusCode).toBe(404);expect(r.headers['cache-control']).toBe('no-store');expect(mocks.download).not.toHaveBeenCalled();});
 it('does not relay unexpected non-image responses',async()=>{mocks.download.mockResolvedValue(new Response('{}',{headers:{'Content-Type':'application/json'}}));expect((await app.inject(path(810006))).statusCode).toBe(404);});
 it('recognizes Telegram JPEGs delivered as application/octet-stream',async()=>{mocks.download.mockResolvedValue(new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'application/octet-stream'}}));const r=await app.inject(path(810008));expect(r.statusCode).toBe(200);expect(r.headers['content-type']).toContain('image/jpeg');});
 it('uses the active branded bot for both the file lookup and its private download',async()=>{const api={getUserProfilePhotos:vi.fn().mockResolvedValue({photos:[[{file_id:'clone-file'}]]}),getFile:vi.fn().mockResolvedValue({file_path:'photos/clone.jpg',file_size:4})};rememberBotToken(api as never,'987654321:FAKE_CLONE_TOKEN');mocks.runtime.mockResolvedValue({bot:{api,botInfo:{id:987654321}}});const r=await app.inject(path(810007));expect(r.statusCode).toBe(200);expect(api.getFile).toHaveBeenCalledWith('clone-file');expect(mocks.download.mock.calls[0][0]).toContain('987654321:FAKE_CLONE_TOKEN/photos/clone.jpg');expect(mocks.photos).not.toHaveBeenCalled();});
});
