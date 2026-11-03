import {describe,it,expect,vi} from 'vitest';
import catalog from '../src/i18n/bot-messages.json';
import inventory from '../src/i18n/bot-message-manifest.json';
import {BOT_LANGUAGES,tr,withBotLanguage,normalizeBotLanguage,botLanguage} from '../src/services/bot-i18n.js';
import {startPrivate,helpText,rulesText} from '../src/bot/texts.js';
import {formatDuration,parseDuration} from '../src/utils/duration.js';

const records=catalog as Record<string,Record<string,string>>;
const protectedTokens=(text:string)=>[...text.matchAll(/\{[^{}]+\}|<[^>]+>|https?:\/\/[^\s<>]+|(?<![^\s>])\/[a-z][a-z_0-9]*(?![\p{L}\p{N}_])|&(?:[a-z]+|#\d+);/giu)].map(m=>m[0]).sort();
describe('complete local Telegram catalogs',()=>{
 it.each(BOT_LANGUAGES.filter(code=>code!=='es'))('has a verified translation of every static message in %s',language=>{
  expect(inventory.messages.length).toBeGreaterThan(900);
  for(const key of inventory.messages){const target=records[language]?.[key];expect(target,language+': '+key).toBeTypeOf('string');expect(target.trim().length).toBeGreaterThan(0);expect(protectedTokens(target),language+': '+key).toEqual(protectedTokens(key));
   const tags=(s:string)=>[...s.matchAll(/<[^>]+>/g)].map(m=>m[0]);const emojis=(s:string)=>[...s.matchAll(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu)].map(m=>m[0]).sort();
   expect(tags(target)).toEqual(tags(key));expect(emojis(target)).toEqual(emojis(key));expect(target).not.toContain('\uFFFD');
  }
 });
 it('normalizes Telegram locales and falls back to Spanish',()=>{expect(normalizeBotLanguage('pt-BR')).toBe('pt');expect(normalizeBotLanguage('zh_CN')).toBe('zh');expect(normalizeBotLanguage('invalid')).toBe('es');expect(tr('Uncatalogued custom text')).toBe('Uncatalogued custom text');});
 it('keeps simultaneous group languages isolated across await boundaries',async()=>{
  const values=await Promise.all(['en','pt','fr'].map(language=>withBotLanguage(language,async()=>{await new Promise(r=>setTimeout(r,5));return {language:botLanguage(),text:tr('📚 Ayuda')};})));
  expect(values.map(v=>v.language)).toEqual(['en','pt','fr']);expect(new Set(values.map(v=>v.text)).size).toBe(3);expect(botLanguage()).toBe('es');
 });
 it('translates replies without network calls or altering interpolated user content',async()=>{
  const network=vi.spyOn(globalThis,'fetch');
  try{for(const language of BOT_LANGUAGES.filter(c=>c!=='es'))withBotLanguage(language,()=>{
   const name='&lt;Custom &amp; name&gt; {0}';expect(startPrivate(name,true)).toContain(name);
   const custom='REGLAS PERSONALES /ban <b>Literal</b>';expect(rulesText('Mi grupo',custom)).toContain(custom);
   const help=helpText('mod');expect(help).toContain('/ban');expect(help).not.toContain('Banea (ej.');expect(help.length).toBeLessThan(4096);
  });expect(network).not.toHaveBeenCalled();}finally{network.mockRestore();}
 });
 it('keeps command durations independent of the reply language',()=>{for(const language of BOT_LANGUAGES)withBotLanguage(language,()=>{expect(parseDuration('30m')).toBe(1800);expect(parseDuration('7d')).toBe(604800);expect(parseDuration('permanente')).toBe(0);expect(formatDuration(3600)).not.toBe('');});});
});
