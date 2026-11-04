import type {Message,User} from 'grammy/types';

/** Telegram's structured content is inspected locally; identifiers and metadata are never treated as visible text. */
export interface MessageContent {text:string;links:string[];types:Set<string>}
const cache=new WeakMap<object,MessageContent>();
const childKeys=['text','blocks','items','cells','caption','credit','summary','button','buttons','alternative_text','expression','label'] as const;
const separated=new Set(['blocks','items','cells','buttons']);
const mediaTypes:Record<string,string>={animation:'gif',photo:'photo',video:'video',audio:'audio',document:'document',voice_note:'voice'};
export function isGuestMessage(message:Partial<Message>):boolean{return Boolean((message.guest_bot_caller_user||message.guest_bot_caller_chat)&&(!message.from||message.from.is_bot));}
export function moderationUser(message:Partial<Message>):User|undefined{const user=message.guest_bot_caller_user;return isGuestMessage(message)?(user&&!user.is_bot&&Number.isSafeInteger(user.id)&&user.id>0?user:undefined):message.from;}
export function messageContent(message:Partial<Message>):MessageContent{
 const hit=cache.get(message);if(hit)return hit;
 const links=new Set<string>(),types=new Set<string>();let nodes=0;
 function walk(node:unknown,depth=0,separator=''):string{
  if(++nodes>20000||depth>64)return '';
  if(typeof node==='string')return node.slice(0,65536);
  if(!node||typeof node!=='object')return '';
  if(Array.isArray(node))return node.map(v=>walk(v,depth+1,separator)).join(separator).slice(0,131072);
  const value=node as Record<string,unknown>,type=String(value.type??'');
  if(mediaTypes[type])types.add(mediaTypes[type]!);
  if(type==='spoiler'||value.has_spoiler===true)types.add('spoiler');if(type==='custom_emoji')types.add('custom_emoji');
  if(typeof value.url==='string')links.add(value.url);
  // URL-bearing buttons can also hold Mini App or login URLs. Never fetch them.
  for(const key of ['web_app','login_url']){const target=value[key] as {url?:unknown}|undefined;if(typeof target?.url==='string')links.add(target.url);}
  return childKeys.filter(key=>value[key]!==undefined).map(key=>walk(value[key],depth+1,separated.has(key)?'\n':'')).join('').slice(0,131072);
 }
 const raw=message as unknown as Record<string,unknown>;
 for(const name of ['sticker','voice','audio','video','photo','document','poll','story','giveaway','giveaway_winners'])if(raw[name])types.add(name==='giveaway_winners'?'giveaway':name);
 if(message.animation)types.add('gif');if(message.forward_origin)types.add('forward');if(message.sender_chat)types.add('anonymous');
 if(message.rich_message)types.add('rich_message');if(isGuestMessage(message))types.add('guest_bot');
 if(message.live_photo){types.add('live_photo');types.add('photo');types.add('video');}
 if(message.has_media_spoiler)types.add('spoiler');if(message.external_reply)types.add('external_reply');
 const normal=message.text??message.caption??'';
 for(const entity of message.entities??message.caption_entities??[]){if(entity.type==='text_link')links.add(entity.url);if(entity.type==='url')links.add(normal.slice(entity.offset,entity.offset+entity.length));if(entity.type==='spoiler'||entity.type==='custom_emoji')types.add(entity.type);}
 const rich=message.rich_message?walk(message.rich_message):'';
 const text=[normal,rich].filter(Boolean).join('\n');for(const match of text.matchAll(/(?:https?:\/\/|www\.|(?:t\.me|telegram\.me)\/)[^\s<>"']+/gi))links.add(match[0]);
 const result={text,links:[...links],types};cache.set(message,result);return result;
}
/** Creates only local examples; it never calls Telegram or interprets example text as markup. */
export function contentExample(text:string,type:string):Partial<Message>{
 const m:Record<string,unknown>={text,message_id:0,entities:[]};
 if(type==='gif')m.animation={};else if(type==='forward')m.forward_origin={};else if(type==='anonymous')m.sender_chat={};
 else if(type==='rich_message'){delete m.text;m.rich_message={blocks:[{type:'paragraph',text}]};}
 else if(type==='guest_bot'){m.from={id:999,is_bot:true,first_name:'Example'};m.guest_bot_caller_user={id:998,is_bot:false,first_name:'Example'};}
 else if(type==='spoiler')m.has_media_spoiler=true;
 else if(type==='custom_emoji')m.entities=[{type:'custom_emoji',offset:0,length:1,custom_emoji_id:'example'}];
 else if(type!=='text'&&type!=='invite')m[type]={};
 return m as Partial<Message>;
}
