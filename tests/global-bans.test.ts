import { beforeEach,describe,it,expect,vi } from 'vitest';
const m=vi.hoisted(()=>({one:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({one:m.one,many:vi.fn()}));
import { addGban,removeGban } from '../src/db/repositories/filters.js';
beforeEach(()=>vi.clearAllMocks());
describe('manual global bans are exclusive to ID 900000001',()=>{
 it.each([123,42,null])('rejects actor %s before touching storage',async actor=>{await expect(addGban(777,'QA',actor)).rejects.toMatchObject({statusCode:403});await expect(removeGban(777,actor as number)).rejects.toMatchObject({statusCode:403});expect(m.one).not.toHaveBeenCalled();});
 it('permits the Developer and records that identity',async()=>{m.one.mockResolvedValue({user_id:777});await addGban(777,'QA',900000001);expect(m.one.mock.calls[0][1]).toEqual([777,'QA',900000001]);await expect(removeGban(777,900000001)).resolves.toBe(true);});
 it('protects the Developer even against a mistaken self-ban',async()=>{await expect(addGban(900000001,'QA',900000001)).rejects.toThrow('protegida');expect(m.one).not.toHaveBeenCalled();});
});
