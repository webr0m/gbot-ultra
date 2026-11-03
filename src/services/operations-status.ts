import {readFile} from 'node:fs/promises';
import path from 'node:path';

const labels = {http:'Mini App',database:'Base de datos',webhook:'Conexión con Telegram',scheduler:'Tareas programadas',backup:'Respaldo automático'};
const validDate=(value:unknown):string|null=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export async function operationsStatus() {
  let data:Record<string,any>|null=null;
  try{data=JSON.parse(await readFile(path.join(process.cwd(),'var','operations','monitor.json'),'utf8'));}catch{/* No private errors or filesystem paths leave the API. */}
  const checkedAt=validDate(data?.checkedAt),stale=!checkedAt||Date.now()-Date.parse(checkedAt)>12*60_000;
  const retained=data?.backup?.retained;
  return {
    checkedAt,stale,status:stale?'unknown':data?.incidentStatus==='healthy'?'ok':'error',
    checks:Object.entries(labels).map(([id,label])=>({id,label,status:stale?'unknown':data?.checks?.[id]?.status==='ok'?'ok':'error'})),
    backup:{createdAt:validDate(data?.backup?.createdAt),verifiedAt:validDate(data?.backup?.verifiedAt),retained:Number.isInteger(retained)?retained:0},
    notificationsEnabled:data?.notificationsEnabled===true,notificationFailed:data?.notificationFailed===true,
    incidents:(Array.isArray(data?.incidents)?data.incidents:[]).slice(0,10).map((item:Record<string,unknown>)=>({at:validDate(item.at),recovered:item.state==='healthy'})),
  };
}
