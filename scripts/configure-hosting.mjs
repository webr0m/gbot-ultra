// Metadata-only deployment step: no webhook changes, group messages or moderation.
import path from 'node:path';import {fileURLToPath} from 'node:url';import dotenv from 'dotenv';
dotenv.config({path:path.join(path.dirname(fileURLToPath(import.meta.url)),'../.env'),quiet:true});
const {createBot,configureBot}=await import('../dist/bot/index.js');
const {BOT_LANGUAGES}=await import('../dist/services/bot-i18n.js');
const bot=createBot();await bot.init();await configureBot(bot);
for(const language of BOT_LANGUAGES)for(const scope of [{type:'default'},{type:'all_group_chats'}]){
 const commands=await bot.api.getMyCommands({scope,language_code:language});
 if(!['setup','inbox','language'].every(name=>commands.some(c=>c.command===name)))throw new Error('Command metadata verification failed');
}
console.log(JSON.stringify({commandsConfigured:true,languages:BOT_LANGUAGES.length,webhookChanged:false}));
