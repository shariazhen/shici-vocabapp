/* 本地单测后端核心逻辑，不用部署：node test.mjs */
import { shouldFire, vapidJWT } from './src/index.js'
let pass = 0, fail = 0
const ok = (n, c) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n)) }
const U = (h, m) => Date.UTC(2026, 9, 6, h, m, 0)

console.log('shouldFire — 北京 tz=8，活跃 9–22，间隔 30：')
const bj = { tzOffset: 8, activeStart: 9, activeEnd: 22, intervalMin: 30 }
ok('01:00 UTC = 本地 09:00 → 推',          shouldFire(bj, U(1, 0)) === true)
ok('01:30 UTC = 本地 09:30 → 推',          shouldFire(bj, U(1, 30)) === true)
ok('00:30 UTC = 本地 08:30 → 不推（时段外）', shouldFire(bj, U(0, 30)) === false)
ok('13:30 UTC = 本地 21:30 → 推',          shouldFire(bj, U(13, 30)) === true)
ok('14:00 UTC = 本地 22:00 → 不推（到点关）', shouldFire(bj, U(14, 0)) === false)
ok('18:00 UTC = 本地 02:00 → 不推（跨零点）', shouldFire(bj, U(18, 0)) === false)

console.log('shouldFire — 洛杉矶 tz=-7：')
const la = { tzOffset: -7, activeStart: 9, activeEnd: 22, intervalMin: 30 }
ok('16:00 UTC = 本地 09:00 → 推', shouldFire(la, U(16, 0)) === true)
ok('15:30 UTC = 本地 08:30 → 不推', shouldFire(la, U(15, 30)) === false)
ok('04:30 UTC = 本地 21:30 → 推', shouldFire(la, U(4, 30)) === true)

console.log('shouldFire — 间隔 60 / 120（tz=0 全天）：')
ok('60 分：10:00 → 推',  shouldFire({ tzOffset: 0, activeStart: 0, activeEnd: 24, intervalMin: 60 }, U(10, 0)) === true)
ok('60 分：10:30 → 不推', shouldFire({ tzOffset: 0, activeStart: 0, activeEnd: 24, intervalMin: 60 }, U(10, 30)) === false)
ok('120 分：12:00 → 推',  shouldFire({ tzOffset: 0, activeStart: 0, activeEnd: 24, intervalMin: 120 }, U(12, 0)) === true)
ok('120 分：13:00 → 不推', shouldFire({ tzOffset: 0, activeStart: 0, activeEnd: 24, intervalMin: 120 }, U(13, 0)) === false)
ok('缺字段时走默认值 9–22/30', shouldFire({ tzOffset: 8 }, U(1, 0)) === true)

console.log('VAPID JWT：')
const b64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u }
const u8b64 = (u) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
const jwt = await vapidJWT('https://fcm.googleapis.com', 'mailto:test@shici.app', u8b64(rawPub), jwk.d)
const parts = jwt.split('.')
ok('结构为 header.payload.sig', parts.length === 3)
const pl = JSON.parse(new TextDecoder().decode(b64u(parts[1])))
ok('aud 正确', pl.aud === 'https://fcm.googleapis.com')
ok('sub 正确', pl.sub === 'mailto:test@shici.app')
ok('exp 在未来且不超过 24 小时', pl.exp > Date.now() / 1000 && pl.exp < Date.now() / 1000 + 86400)
const vk = await crypto.subtle.importKey('raw', rawPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
ok('签名能被公钥验过（真实推送服务会认这个）',
   await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])) === true)

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败')
if (fail) process.exit(1)
