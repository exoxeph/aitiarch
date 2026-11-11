import {describe,expect,it} from 'vitest';
import {createSecurity} from '../server/security.ts';

// The local server's front door: which hosts and origins may talk to it, and how the per-launch token becomes a cookie.
const make=(over:Partial<Parameters<typeof createSecurity>[0]>={})=>createSecurity({port:()=>4317,...over});

describe('Host header (DNS rebinding)',()=>{
 it('accepts the three loopback names on our port only',()=>{
  const s=make();
  for(const h of ['127.0.0.1:4317','localhost:4317','aitiarch.localhost:4317','LOCALHOST:4317'])expect(s.hostOk(h),h).toBe(true);
  for(const h of ['127.0.0.1:4318','evil.com:4317','evil.com','127.0.0.1','attacker.localhost:4317','',undefined])expect(s.hostOk(h),String(h)).toBe(false);
 });
 it('follows the port the server actually bound',()=>{let p=0;const s=createSecurity({port:()=>p});p=50123;expect(s.hostOk('localhost:50123')).toBe(true);expect(s.hostOk('localhost:4317')).toBe(false);});
});

describe('Origin header',()=>{
 it('accepts only our own origins, plus any explicitly allowed one',()=>{
  const s=make({extraOrigins:['http://127.0.0.1:5173']});
  for(const o of ['http://127.0.0.1:4317','http://localhost:4317','http://aitiarch.localhost:4317','http://127.0.0.1:5173'])expect(s.originOk(o),o).toBe(true);
  for(const o of ['https://127.0.0.1:4317','http://evil.com','null','http://localhost:9999',''])expect(s.originOk(o),o).toBe(false);
 });
});

describe('the per-launch token',()=>{
 it('is random per launch and long enough',()=>{const a=make(),b=make();expect(a.token).toMatch(/^[0-9a-f]{48}$/);expect(a.token).not.toBe(b.token);});
 it('reads it back from the cookie header only when it matches exactly',()=>{
  const s=make();
  expect(s.tokenOk(`aitiarch=${s.token}`)).toBe(true);expect(s.tokenOk(`other=1; aitiarch=${s.token}; x=2`)).toBe(true);
  expect(s.tokenOk(`aitiarch=${s.token.slice(1)}`)).toBe(false);expect(s.tokenOk('aitiarch=')).toBe(false);expect(s.tokenOk(undefined)).toBe(false);
 });
 it('sets an HttpOnly, SameSite=Strict, path-wide cookie',()=>{const s=make();expect(s.cookie()).toBe(`aitiarch=${s.token}; Path=/; HttpOnly; SameSite=Strict`);});
 it('exchanges a launch link for the cookie only when the token matches',()=>{
  const s=make();
  expect(s.launch(new URL(`http://127.0.0.1:4317/?launch=${s.token}`))).toBe('ok');
  expect(s.launch(new URL('http://127.0.0.1:4317/?launch=wrong'))).toBe('bad');
  expect(s.launch(new URL('http://127.0.0.1:4317/'))).toBe('none');
 });
 it('in launch mode, a session is only handed to a browser that already holds the cookie',()=>{
  const s=make({requireLaunch:true});expect(s.sessionAllowed(undefined)).toBe(false);expect(s.sessionAllowed(`aitiarch=${s.token}`)).toBe(true);
  const open=make();expect(open.sessionAllowed(undefined)).toBe(true); // test and embedded servers keep the old same-origin handshake
 });
});
