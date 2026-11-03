import {readFileSync} from 'node:fs';
import path from 'node:path';
const value=JSON.parse(readFileSync(path.join(process.cwd(),'public','community.json'),'utf8')) as Record<string,unknown>;
function telegramLink(key:string){const raw=value[key];if(typeof raw!=='string'||!/^https:\/\/t\.me\/[A-Za-z0-9_+/-]+$/.test(raw))throw Error('Enlace oficial invÃ¡lido: '+key);return raw;}
export const COMMUNITY={bot:telegramLink('bot'),group:telegramLink('group'),channel:telegramLink('channel'),contact:telegramLink('contact')} as const;
