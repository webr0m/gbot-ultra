import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {requireAuth,bodyOf,parseIntParam} from '../helpers.js';
import {assertDeveloper} from '../../services/roles.js';
import {many} from '../../db/pool.js';
import {createBroadcast,listBroadcasts,broadcastDetail,prepareBroadcast,transitionBroadcast,englishBroadcast} from '../../services/broadcasts.js';
export function registerBroadcastRoutes(app:FastifyInstance){
 const actor=(request:Parameters<typeof requireAuth>[0])=>{const auth=requireAuth(request);assertDeveloper(auth.user.id);return auth.user.id;};
 app.get('/api/broadcasts',async(request,reply)=>{const id=actor(request);reply.header('Cache-Control','no-store');return {ok:true,items:await listBroadcasts(id)};});
 app.post('/api/broadcasts/english',async request=>{const id=actor(request),body=z.object({text:z.string().trim().min(1).max(3900),consent:z.boolean()}).parse(bodyOf(request));return {ok:true,...await englishBroadcast(id,body.text,body.consent)};});
 app.get('/api/broadcasts/:id',async(request,reply)=>{const id=actor(request),campaign=z.uuid().parse((request.params as {id:string}).id);reply.header('Cache-Control','no-store');return {ok:true,...await broadcastDetail(id,campaign)};});
 app.get('/api/broadcasts/:id/recipients',async(request,reply)=>{const id=actor(request),campaign=z.uuid().parse((request.params as {id:string}).id),q=request.query as Record<string,unknown>;await broadcastDetail(id,campaign);reply.header('Cache-Control','no-store');const rows=await many('SELECT user_id,language,state,language_sent,error_kind,error_code,updated_at FROM broadcast_recipients WHERE campaign_id=$1 ORDER BY user_id LIMIT 51 OFFSET $2',[campaign,parseIntParam(q.offset,0,0,1000000)]);return {ok:true,items:rows.slice(0,50),hasMore:rows.length>50};});
 app.post('/api/broadcasts',async request=>{const id=actor(request);return {ok:true,campaign:await createBroadcast(id,bodyOf(request))};});
 app.post('/api/broadcasts/:id',async request=>{const actorId=actor(request),id=z.uuid().parse((request.params as {id:string}).id),body=z.object({action:z.enum(['prepare','start','pause','resume','cancel']),version:z.number().int().positive(),confirm:z.boolean().default(false),previewHash:z.string().max(100).optional()}).parse(bodyOf(request));if(body.action==='prepare')return prepareBroadcast(actorId,id,body.version);return transitionBroadcast(actorId,id,body.version,body.action,body.confirm,body.previewHash);});
}
