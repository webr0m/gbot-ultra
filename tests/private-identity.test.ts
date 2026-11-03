import {afterEach,describe,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
describe('private installation identity',()=>{
 it('loads only the configured fictional principal',async()=>{
  vi.stubEnv('DEVELOPER_TELEGRAM_ID','900000002');vi.resetModules();
  const roles=await import('../src/services/roles.js');
  expect(roles.DEVELOPER_ID).toBe(900000002);expect(()=>roles.assertDeveloper(900000002)).not.toThrow();
  expect(()=>roles.assertDeveloper(900000001)).toThrow();
 });
 it('disables privileged management if no principal is configured',async()=>{
  vi.stubEnv('DEVELOPER_TELEGRAM_ID','');vi.resetModules();const roles=await import('../src/services/roles.js');
  for(const id of [null,undefined,0,900000001])expect(()=>roles.assertDeveloper(id)).toThrow();
  expect(roles.globalRole(0,new Set())).toBeNull();
 });
 it.each(['-1','12.5','abc','9007199254740992'])('rejects invalid configuration %s',async value=>{
  vi.stubEnv('DEVELOPER_TELEGRAM_ID',value);vi.resetModules();await expect(import('../src/services/roles.js')).rejects.toThrow('DEVELOPER_TELEGRAM_ID');
 });
});
