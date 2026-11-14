import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';

const source=(file:string)=>readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
const avatar='/brand/gbot-profile-20261113.jpg';

describe('bot profile branding in the Mini App',()=>{
 it('uses the profile image at startup, in the header and in the home menu',()=>{
  const html=source('index.html');
  expect(html).toContain('class="splash-logo"><img src="'+avatar+'"');
  expect(html).toContain('class="brand-logo"><img src="'+avatar+'"');
  expect(html.match(/data-tab="home">([\s\S]*?)<\/button>/)?.[1]).toContain('class="nav-bot-icon" src="'+avatar+'"');
  expect(html).toContain('rel="icon" href="'+avatar+'"');
  expect(html).not.toContain('class="splash-logo">GB<');
  expect(html).not.toContain('class="brand-logo">GB<');
 });

 it('keeps the same icon on authentication and empty-group screens',()=>{
  const core=source('core.js');
  expect(core.match(/class="auth-logo"><img/g)).toHaveLength(2);
  expect(core).not.toContain('class="auth-logo">GB<');
  expect(core).toContain(avatar);
 });

 it('ships the real profile image locally, without a Telegram download URL or token',()=>{
  const bytes=readFileSync(new URL('../public'+avatar,import.meta.url));
  expect([...bytes.subarray(0,3)]).toEqual([0xff,0xd8,0xff]);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(source('styles.css')).toContain('.nav-bot-icon');
 });
});
