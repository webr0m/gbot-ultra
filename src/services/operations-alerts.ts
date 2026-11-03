import {tr} from './bot-i18n.js';
export function localizedOperationAlert(healthy:boolean,failing:string[],language:string){
 const labels:Record<string,string>={http:tr('Mini App',[],language),database:tr('Base de datos',[],language),webhook:tr('Conexión con Telegram',[],language),scheduler:tr('Tareas programadas',[],language),backup:tr('Respaldo automático',[],language)};
 return healthy?tr('✅ GBot se recuperó. Mini App, base de datos, Telegram, tareas y respaldos responden correctamente.',[],language):tr('⚠️ GBot requiere revisión: {0}. Se confirmó en dos revisiones consecutivas. Consulta Estado del servicio en el panel.',[failing.map(id=>labels[id]??tr('Servicio',[],language)).join(', ')],language);
}
