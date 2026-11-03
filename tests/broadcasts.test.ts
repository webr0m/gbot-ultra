import {describe,it,expect} from 'vitest';
import {validBroadcastTranslation,validateBroadcastText,broadcastSchema} from '../src/services/broadcasts.js';
import {mainMenuKeyboard,helpKeyboard} from '../src/bot/keyboards.js';
import {COMMUNITY} from '../src/services/community.js';
import {withBotLanguage,BOT_LANGUAGES} from '../src/services/bot-i18n.js';
describe('broadcast content and contact entry points',()=>{
 it('preserves prices, URLs and commands when validating translations',()=>{const text='Pro 135 ⭐: /premium https://example.com/planes';expect(validBroadcastTranslation(text,'Pro 135 ⭐: /premium https://example.com/planes')).toBe(true);expect(validBroadcastTranslation(text,'Pro 150 ⭐: /premium https://example.com/planes')).toBe(false);expect(validBroadcastTranslation(text,'Pro 135 ⭐: /start https://example.com/planes')).toBe(false);expect(validBroadcastTranslation(text,'Pro 135 ⭐: /premium https://other.invalid/planes')).toBe(false);});
 it('rejects credentials and malformed announcements before preparation',()=>{expect(()=>validateBroadcastText('gsk_'+'A'.repeat(30))).toThrow(/credenciales/);expect(()=>validateBroadcastText('postgres://qa:password@localhost/qa')).toThrow(/credenciales/);expect(broadcastSchema.safeParse({}).success).toBe(false);expect(validBroadcastTranslation('Hola','')).toBe(false);expect(validBroadcastTranslation('Hola','a'.repeat(3901))).toBe(false);});
 it('keeps broadcast control exclusive to the configured principal',()=>{const buttons=(id:number)=>mainMenuKeyboard('fixture_bot','https://example.com/','',id).inline_keyboard.flat();expect(buttons(900000001).some(b=>'web_app'in b&&b.web_app?.url.includes('tool=broadcast'))).toBe(true);expect(buttons(900000002).some(b=>'web_app'in b&&b.web_app?.url.includes('tool=broadcast'))).toBe(false);});
 it.each(BOT_LANGUAGES)('keeps contact links usable in %s',language=>withBotLanguage(language,()=>{for(const k of [mainMenuKeyboard('fixture_bot',null,'',5),helpKeyboard()])expect(k.inline_keyboard.flat().some(b=>'url'in b&&b.url===COMMUNITY.contact)).toBe(true);expect(COMMUNITY.contact).toBe('https://t.me/webrom_bot');}));
});
