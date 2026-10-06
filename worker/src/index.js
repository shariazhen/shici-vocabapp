/* ═══════════════════════════════════════════════════════════════════
   拾词 · Cloudflare Worker
     GET  /health
     GET  /lookup?word=   查词：内置中文词典 → D1 ECDICT → 公共英文词典兜底
     GET  /enrich?word=   用 Workers AI 给生词生成助记/搭配/地道例句/填空
     POST /subscribe      存/删 Web Push 订阅（含时区、活跃时段、间隔）
     POST /sync           多设备同步，按 updatedAt 后写入胜出
     cron（每 30 分钟）   在各设备活跃时段内发「无载荷」推送叫醒它本地挑词
   绑定见 wrangler.toml：D1=DB，AI=AI，变量 VAPID_PUBLIC_KEY / VAPID_SUBJECT，
   密钥 VAPID_PRIVATE_KEY
   ═══════════════════════════════════════════════════════════════════ */
import { DICT_SEED } from './dict-seed.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } })

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(req.url)
    try {
      if (url.pathname === '/health')    return json({ ok: true, ts: Date.now() })
      if (url.pathname === '/lookup')    return await handleLookup(url, env)
      if (url.pathname === '/enrich')    return await handleEnrich(url, env)
      if (url.pathname === '/subscribe') return await handleSubscribe(req, url, env)
      if (url.pathname === '/sync')      return await handleSync(req, env)
      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500)
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPush(event.scheduledTime || Date.now(), env))
  }
}

/* ── 查词 ─────────────────────────────────────────── */
async function handleLookup(url, env) {
  const word = (url.searchParams.get('word') || '').trim()
  if (!word) return json({ error: 'no word' }, 400)
  const key = word.toLowerCase()
  if (DICT_SEED[key]) return json({ w: word, ...DICT_SEED[key], src: 'seed' })
  if (env.DB) {
    try {
      const row = await env.DB
        .prepare('SELECT phonetic AS p, pos, translation AS d FROM dict WHERE word=?1 COLLATE NOCASE LIMIT 1')
        .bind(word).first()
      if (row && row.d) return json({ w: word, p: row.p || '', pos: row.pos || '', d: row.d, ex: '', tr: '', src: 'ecdict' })
    } catch (_) { /* 没建 dict 表就跳过 */ }
  }
  try {
    const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word))
    if (r.ok) {
      const arr = await r.json(), e0 = arr && arr[0]
      if (e0) {
        let p = '', pos = '', d = '', ex = ''
        for (const ph of (e0.phonetics || [])) { if (ph.text) { p = ph.text; break } }
        const m0 = (e0.meanings || [])[0]
        if (m0) {
          pos = abbr(m0.partOfSpeech)
          const d0 = (m0.definitions || [])[0]
          if (d0) { d = d0.definition || ''; ex = d0.example || '' }
        }
        return json({ w: word, p, pos, d, ex, tr: '', src: 'dictionaryapi' })
      }
    }
  } catch (_) {}
  return json({ w: word, p: '', pos: '', d: '', ex: '', tr: '', src: 'none' })
}
const abbr = (p) => ({ noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', pronoun: 'pron.', preposition: 'prep.', conjunction: 'conj.', interjection: 'int.' }[p] || p || '')

/* ── AI 补全：助记 / 搭配 / 地道二选一 / 填空 ───────── */
const ENRICH_PROMPT = `你在为一个做 TikTok 跨境电商、达人 BD 的中国用户编写英语学习卡片。
给定一个英文单词，输出严格的 JSON（不要代码块、不要任何解释），字段：
{"p":"美音IPA","pos":"n./v./adj.","d":"贴工作语境的中文释义",
 "ex":"一句地道的美国商务英语例句","tr":"例句中文",
 "mn":{"root":"词源或构词拆解，拆不出就填空字符串","hook":"40字内的联想钩子","confuse":"易混点，没有就填空字符串"},
 "coll":["英文搭配 中文","..."],
 "nat":{"good":"地道说法","bad":"中国人常犯的那种错误说法","why":"一句话说清错在哪"},
 "blank":{"s":"含且仅含一个 ____ 的英文句子","a":"填入的词","tr":"中文"}}
要求：例句要像真实工作邮件/消息里的句子；bad 必须是中国人真会犯的错（中式直译、冠词、单复数、搭配），不要编造。`

async function handleEnrich(url, env) {
  const word = (url.searchParams.get('word') || '').trim()
  if (!word) return json({ error: 'no word' }, 400)
  if (DICT_SEED[word.toLowerCase()]) return json({ w: word, ...DICT_SEED[word.toLowerCase()], src: 'seed' })
  if (!env.AI) return json({ error: 'AI 未绑定：在 wrangler.toml 里加 [ai] binding = "AI"' }, 501)
  try {
    const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: ENRICH_PROMPT }, { role: 'user', content: word }],
      max_tokens: 900, temperature: 0.4
    })
    const txt = (r && (r.response || r.result || '')) + ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return json({ error: 'AI 没返回 JSON', raw: txt.slice(0, 300) }, 502)
    const o = JSON.parse(m[0])
    o.w = word; o.src = 'ai'
    if (o.blank && o.blank.s && (o.blank.s.match(/____/g) || []).length !== 1) o.blank = null
    return json(o)
  } catch (e) {
    return json({ error: 'AI 失败：' + String((e && e.message) || e) }, 502)
  }
}

/* ── 订阅 ─────────────────────────────────────────── */
async function handleSubscribe(req, url, env) {
  const body = await req.json()
  if (url.searchParams.get('remove') === '1' || body.remove) {
    const ep = body.endpoint || (body.subscription && body.subscription.endpoint)
    if (ep) await env.DB.prepare('DELETE FROM subs WHERE endpoint=?1').bind(ep).run()
    return json({ ok: true })
  }
  const sub = body.subscription
  if (!sub || !sub.endpoint) return json({ error: 'no subscription' }, 400)
  await env.DB.prepare(
    'INSERT INTO subs (endpoint, sub, token, tzOffset, activeStart, activeEnd, intervalMin, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ' +
    'ON CONFLICT(endpoint) DO UPDATE SET sub=?2, token=?3, tzOffset=?4, activeStart=?5, activeEnd=?6, intervalMin=?7, updatedAt=?8'
  ).bind(
    sub.endpoint, JSON.stringify(sub), body.token || '',
    num(body.tzOffset, 8), num(body.activeStart, 9), num(body.activeEnd, 22), num(body.intervalMin, 30), Date.now()
  ).run()
  return json({ ok: true })
}
const num = (v, d) => { v = Number(v); return isFinite(v) ? v : d }

/* ── 同步（LWW） ──────────────────────────────────── */
async function handleSync(req, env) {
  const body = await req.json()
  const token = (body.token || '').trim()
  if (!token) return json({ error: 'no token' }, 400)
  const incoming = Array.isArray(body.words) ? body.words : []
  const row = await env.DB.prepare('SELECT data FROM blobs WHERE token=?1').bind(token).first()
  let stored = []
  if (row && row.data) { try { stored = JSON.parse(row.data) } catch (_) {} }
  const map = {}, keyOf = (w) => String(w.w || '').trim().toLowerCase()
  stored.forEach((w) => { map[keyOf(w)] = w })
  incoming.forEach((w) => { const k = keyOf(w); if (!map[k] || (w.updatedAt || 0) > (map[k].updatedAt || 0)) map[k] = w })
  const merged = Object.keys(map).map((k) => map[k])
  await env.DB.prepare('INSERT INTO blobs (token, data, updatedAt) VALUES (?1,?2,?3) ON CONFLICT(token) DO UPDATE SET data=?2, updatedAt=?3')
    .bind(token, JSON.stringify(merged), Date.now()).run()
  return json({ words: merged, count: merged.length })
}

/* ── 定时推送 ─────────────────────────────────────── */
async function runPush(scheduledMs, env) {
  const rows = await env.DB.prepare('SELECT endpoint, sub, tzOffset, activeStart, activeEnd, intervalMin FROM subs').all()
  let sent = 0
  for (const s of ((rows && rows.results) || [])) {
    if (!shouldFire(s, scheduledMs)) continue
    try {
      const code = await sendPush(JSON.parse(s.sub), env)
      if (code === 404 || code === 410) await env.DB.prepare('DELETE FROM subs WHERE endpoint=?1').bind(s.endpoint).run()
      else if (code >= 200 && code < 300) sent++
    } catch (_) {}
  }
  return sent
}
/* 这台设备在这次 cron 该不该收到推送 */
export function shouldFire(s, scheduledMs) {
  const d = new Date(scheduledMs)
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes()
  let localMin = (utcMin + (s.tzOffset || 0) * 60) % 1440
  if (localMin < 0) localMin += 1440
  const hour = Math.floor(localMin / 60)
  const start = s.activeStart == null ? 9 : s.activeStart
  const end   = s.activeEnd   == null ? 22 : s.activeEnd
  if (hour < start || hour >= end) return false
  return (localMin % (s.intervalMin || 30)) < 30
}

/* ── Web Push（无载荷，只做 VAPID 鉴权） ──────────── */
async function sendPush(subscription, env) {
  const endpoint = subscription.endpoint
  const jwt = await vapidJWT(new URL(endpoint).origin, env.VAPID_SUBJECT || 'mailto:you@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { TTL: '1800', Urgency: 'normal', Authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC_KEY }
  })
  return res.status
}

/* ── VAPID JWT（ES256，WebCrypto 现场签） ─────────── */
const b64urlToU8 = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u }
const u8ToB64url = (u) => { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const strToB64url = (s) => u8ToB64url(new TextEncoder().encode(s))

async function importVapidKey(pubB64, privB64) {
  const pub = b64urlToU8(pubB64)      // 65 字节：0x04 + X(32) + Y(32)
  const d = b64urlToU8(privB64)       // 32 字节私钥
  const jwk = { kty: 'EC', crv: 'P-256', ext: true, d: u8ToB64url(d), x: u8ToB64url(pub.slice(1, 33)), y: u8ToB64url(pub.slice(33, 65)) }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}
export async function vapidJWT(aud, sub, pubB64, privB64) {
  const header = strToB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = strToB64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }))
  const unsigned = header + '.' + payload
  const key = await importVapidKey(pubB64, privB64)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))
  return unsigned + '.' + u8ToB64url(new Uint8Array(sig))
}
