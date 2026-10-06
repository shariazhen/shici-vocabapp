/* ═══════════════════════════════════════════════════════════════════
   拾词 · app.js
   本地优先：学习数据全在 IndexedDB，云端只负责推送、查词、同步。
   ═══════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var CFG = window.SHICI_CONFIG || {};
var API = (CFG.API_BASE || '').replace(/\/+$/, '');
var DAY = 86400000;

/* ───────── IndexedDB ───────── */
var DB_NAME = 'shici', DB_VER = 2, _db = null;

function openDB() {
  return new Promise(function (res, rej) {
    if (_db) return res(_db);
    var rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('words'))    db.createObjectStore('words',    { keyPath: 'w' });
      if (!db.objectStoreNames.contains('logs'))     db.createObjectStore('logs',     { keyPath: 'date' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('drills'))   db.createObjectStore('drills',   { keyPath: 'id', autoIncrement: true });
    };
    rq.onsuccess = function () { _db = rq.result; res(_db); };
    rq.onerror   = function () { rej(rq.error); };
  });
}
function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
function os(store, mode) { return openDB().then(function (db) { return db.transaction(store, mode || 'readonly').objectStore(store); }); }
function dbAll(s)    { return os(s).then(function (o) { return req(o.getAll()); }); }
function dbGet(s, k) { return os(s).then(function (o) { return req(o.get(k)); }); }
function dbPut(s, v) { return os(s, 'readwrite').then(function (o) { return req(o.put(v)); }); }
function dbDel(s, k) { return os(s, 'readwrite').then(function (o) { return req(o.delete(k)); }); }
function dbPutMany(store, arr) {
  if (!arr.length) return Promise.resolve(0);
  return openDB().then(function (db) {
    return new Promise(function (res, rej) {
      var t = db.transaction(store, 'readwrite'), o = t.objectStore(store);
      arr.forEach(function (v) { o.put(v); });
      t.oncomplete = function () { res(arr.length); };
      t.onerror    = function () { rej(t.error); };
    });
  });
}

/* ───────── 设置 ───────── */
var S = {
  dailyNew: 10, activeStart: 9, activeEnd: 22, intervalMin: 30,
  theme: 'auto', pushEnabled: false, syncToken: CFG.SYNC_TOKEN || '',
  autoSpeak: true, drillLen: 10
};
function loadSettings() {
  return dbAll('settings').then(function (rows) { rows.forEach(function (r) { S[r.k] = r.v; }); return S; });
}
function setS(k, v) { S[k] = v; return dbPut('settings', { k: k, v: v }); }

/* ───────── 词条 ───────── */
function normWord(raw, ord) {
  return {
    w: String(raw.w || '').trim(),
    p: raw.p || '', pos: raw.pos || '', d: raw.d || '', ex: raw.ex || '', tr: raw.tr || '',
    tags: raw.tags || [],
    mn:   raw.mn   || { root: '', hook: '', confuse: '' },
    coll: raw.coll || [],
    nat:  raw.nat  || null,
    blank: raw.blank || null,
    ord: ord == null ? 9999 : ord,
    ef: 2.5, reps: 0, intv: 0, due: 0, first: 0,
    status: 'new', fav: false, updatedAt: Date.now()
  };
}
/* 首次装库；已有词只补内容、绝不动学习进度 */
function seedIfNeeded() {
  var seed = window.SEED || [];
  return dbAll('words').then(function (have) {
    var byKey = {}; have.forEach(function (x) { byKey[String(x.w).toLowerCase()] = x; });
    var out = [];
    seed.forEach(function (s, i) {
      var cur = byKey[String(s.w).toLowerCase()];
      if (!cur) { out.push(normWord(s, i)); return; }
      var dirty = false;
      if (cur.ord == null) { cur.ord = i; dirty = true; }
      ['p', 'pos', 'd', 'ex', 'tr'].forEach(function (k) {
        if (!cur[k] && s[k]) { cur[k] = s[k]; dirty = true; }
      });
      if ((!cur.mn || !cur.mn.hook) && s.mn)       { cur.mn = s.mn;       dirty = true; }
      if ((!cur.coll || !cur.coll.length) && s.coll) { cur.coll = s.coll; dirty = true; }
      if (!cur.nat && s.nat)     { cur.nat = s.nat;     dirty = true; }
      if (!cur.blank && s.blank) { cur.blank = s.blank; dirty = true; }
      if (!cur.tags || !cur.tags.length) { cur.tags = s.tags || []; dirty = true; }
      if (dirty) out.push(cur);
    });
    return dbPutMany('words', out);
  });
}

/* ───────── SM-2（精简） ───────── */
function schedule(w, grade) {           // 0 忘记 / 1 模糊 / 2 认识
  if (grade === 0) {
    w.reps = 0; w.intv = 0;
    w.ef = Math.max(1.3, (w.ef || 2.5) - 0.2);
    w.due = Date.now() + 600000;        // 10 分钟后当轮重来
    w.status = 'learning';
  } else {
    var q = grade === 1 ? 3 : 5;
    w.ef = Math.max(1.3, (w.ef || 2.5) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    w.reps = (w.reps || 0) + 1;
    if (w.reps === 1)      w.intv = grade === 1 ? 1 : 2;
    else if (w.reps === 2) w.intv = grade === 1 ? 3 : 5;
    else                   w.intv = Math.round((w.intv || 1) * w.ef * (grade === 1 ? 0.7 : 1));
    w.intv = Math.max(1, Math.min(w.intv, 180));
    w.due = Date.now() + w.intv * DAY;
    w.status = w.intv >= 21 ? 'known' : 'review';
  }
  w.updatedAt = Date.now();
  return w;
}
function firstLearn(w, known) { w.first = w.first || Date.now(); return schedule(w, known ? 2 : 0); }

/* ───────── 每日记录 ───────── */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function blankLog(k) { return { date: k, learned: 0, reviewed: 0, drills: 0, correct: 0 }; }
var logChain = Promise.resolve();
function bumpLog(field, n) {
  /* 读-改-写必须串行，否则连点时后一次会用过期的值覆盖前一次 */
  logChain = logChain.then(function () {
    var k = dayKey();
    return dbGet('logs', k).then(function (l) {
      l = l || blankLog(k);
      l[field] = (l[field] || 0) + (n == null ? 1 : n);
      return dbPut('logs', l);
    });
  }).catch(function (e) { console.warn('bumpLog', e); });
  return logChain;
}
function streak(logs) {
  var m = {}; logs.forEach(function (l) { if ((l.learned || 0) + (l.reviewed || 0) + (l.drills || 0) > 0) m[l.date] = 1; });
  var n = 0, d = new Date();
  if (!m[dayKey(d)]) d.setDate(d.getDate() - 1);   // 今天还没学不算断
  while (m[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ───────── 队列 ───────── */
function byOrd(a, b) { return (a.ord || 0) - (b.ord || 0); }
function getTodayNewWords() {
  return Promise.all([dbAll('words'), dbGet('logs', dayKey())]).then(function (r) {
    var words = r[0], log = r[1] || blankLog(dayKey());
    var left = Math.max(0, (S.dailyNew || 10) - (log.learned || 0));
    return words.filter(function (w) { return w.status === 'new'; }).sort(byOrd).slice(0, left);
  });
}
function getDueReviews() {
  var now = Date.now();
  return dbAll('words').then(function (words) {
    return words.filter(function (w) { return w.status !== 'new' && (w.due || 0) <= now; })
                .sort(function (a, b) { return (a.due || 0) - (b.due || 0); });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   语音：朗读 + 识别 + 打分
   打分器刻意抽成 scoreSpeech() 一层 —— 以后要换 Azure 发音评估那类
   音素级 API，只替换这一个函数，上层不用动。
   ═══════════════════════════════════════════════════════════════════ */
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
var voicesReady = false;
function pickVoice() {
  try {
    var vs = speechSynthesis.getVoices() || [];
    var en = vs.filter(function (v) { return /^en[-_]US/i.test(v.lang); });
    if (!en.length) en = vs.filter(function (v) { return /^en/i.test(v.lang); });
    var good = en.filter(function (v) { return /samantha|ava|allison|google us|siri/i.test(v.name); });
    return (good[0] || en[0] || null);
  } catch (e) { return null; }
}
function speak(text, rate) {
  if (!('speechSynthesis' in window)) return false;
  try {
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = rate || 0.92; u.pitch = 1;
    var v = pickVoice(); if (v) u.voice = v;
    speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = function () { voicesReady = true; };
}

/* 听一次。iOS Safari 从 14.5 起支持，但要联网（音频会发给 Apple），且只适合短句。 */
function listenOnce(ms) {
  return new Promise(function (res, rej) {
    if (!SR) { rej(new Error('no-sr')); return; }
    var r, alts = [], done = false, timer;
    try { r = new SR(); } catch (e) { rej(e); return; }
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 4; r.continuous = false;
    function finish(err) {
      if (done) return; done = true; clearTimeout(timer);
      try { r.abort(); } catch (e) {}
      err ? rej(err) : res(alts);
    }
    r.onresult = function (e) {
      var r0 = e.results[0];
      for (var i = 0; i < r0.length; i++) alts.push(r0[i].transcript);
    };
    r.onerror = function (e) { finish(new Error(e.error || 'sr-error')); };
    r.onend   = function () { finish(null); };
    try { r.start(); } catch (e) { finish(e); return; }
    timer = setTimeout(function () { try { r.stop(); } catch (e) { finish(null); } }, ms || 7000);
  });
}

function tokens(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/).filter(Boolean);
}
function lev(a, b) {
  var m = a.length, n = b.length, prev = [], cur = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur.slice();
  }
  return prev[n];
}
/* 识别结果本来就有噪音，长词容忍 1 个字母的出入 */
function near(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length < 5 || b.length < 5) return false;
  return lev(a, b) <= 1;
}
/* LCS 对齐：标出目标句里哪些词真的被说到了（不要求连续，允许中间插词） */
function align(T, H) {
  var n = T.length, m = H.length, dp = [], i, j;
  for (i = 0; i <= n; i++) { dp.push([]); for (j = 0; j <= m; j++) dp[i][j] = 0; }
  for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
    dp[i][j] = near(T[i - 1], H[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  var marks = []; for (i = 0; i < n; i++) marks.push(false);
  i = n; j = m;
  while (i > 0 && j > 0) {
    if (near(T[i - 1], H[j - 1])) { marks[i - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  return marks;
}
/* ← 换专业发音评估 API 时，改这里 */
function scoreSpeech(target, heardList) {
  var T = tokens(target), best = null;
  (heardList && heardList.length ? heardList : ['']).forEach(function (h) {
    var marks = align(T, tokens(h));
    var got = marks.filter(Boolean).length;
    var sc = T.length ? Math.round(got / T.length * 100) : 0;
    if (!best || sc > best.score) best = { score: sc, marks: marks, tokens: T, heard: h, engine: 'webspeech' };
  });
  return best;
}

/* ═══════════════════════════════════════════════════════════════════
   练习引擎
   ═══════════════════════════════════════════════════════════════════ */
var DIMS = ['认词', '拼写', '听力', '地道', '口语'];
var DRILL = {
  choice:  { dim: '认词', label: '中译英',     hint: '看中文选单词',       need: function (w) { return !!w.d; } },
  spell:   { dim: '拼写', label: '听音拼写',   hint: '听发音拼出来',       need: function (w) { return w.w.length > 2 && !/\s/.test(w.w); } },
  listen:  { dim: '听力', label: '听句选词',   hint: '听句子选出听到的词', need: function (w) { return !!w.ex; } },
  collo:   { dim: '地道', label: '词语搭配',   hint: '选出真实存在的搭配', need: function (w) { return (w.coll || []).length > 0; } },
  natural: { dim: '地道', label: '哪个更地道', hint: '两句挑地道的那句',   need: function (w) { return !!(w.nat && w.nat.good && w.nat.bad); } },
  cloze:   { dim: '地道', label: '场景填空',   hint: '把词填进真实语境',   need: function (w) { return !!(w.blank && w.blank.s); } },
  speak:   { dim: '口语', label: '跟读打分',   hint: '跟读后按词打分',     need: function (w) { return !!w.ex; } }
};

function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function sample(arr, n, exclude) {
  var pool = arr.filter(function (x) { return x !== exclude; });
  return shuffle(pool).slice(0, n);
}

function buildItem(kind, w, pool) {
  var o = { kind: kind, w: w, dim: DRILL[kind].dim };
  if (kind === 'choice') {
    var wrong = sample(pool.filter(function (x) { return x.w !== w.w; }), 3).map(function (x) { return x.w; });
    o.q = w.d; o.sub = w.pos;
    o.opts = shuffle([w.w].concat(wrong)); o.answer = w.w;
  } else if (kind === 'spell') {
    o.q = w.d; o.say = w.w; o.answer = w.w; o.typed = true;
  } else if (kind === 'listen') {
    var wrong2 = sample(pool.filter(function (x) { return x.w !== w.w; }), 3).map(function (x) { return x.w; });
    o.say = w.ex; o.q = '句子里出现了哪个词？';
    o.opts = shuffle([w.w].concat(wrong2)); o.answer = w.w;
  } else if (kind === 'collo') {
    var right = shuffle(w.coll)[0];
    var others = [];
    shuffle(pool).forEach(function (x) {
      if (others.length >= 3 || x.w === w.w) return;
      var c = (x.coll || [])[0]; if (c) others.push(c);
    });
    o.q = w.w; o.sub = w.d;
    o.opts = shuffle([right].concat(others)); o.answer = right;
  } else if (kind === 'natural') {
    o.q = w.w + '　' + w.d;
    o.opts = shuffle([w.nat.good, w.nat.bad]); o.answer = w.nat.good; o.why = w.nat.why;
  } else if (kind === 'cloze') {
    o.q = w.blank.s; o.sub = w.blank.tr; o.answer = w.blank.a; o.typed = true;
  } else if (kind === 'speak') {
    o.say = w.ex; o.q = w.ex; o.sub = w.tr; o.answer = w.ex; o.speakMode = true;
  }
  return o;
}

/* 出题：优先挑学过的词；该项目练得少的词排前面 */
function makeDrillSet(kind, n) {
  return Promise.all([dbAll('words'), dbAll('drills')]).then(function (r) {
    var words = r[0], done = r[1];
    var need = DRILL[kind].need;
    var usable = words.filter(need);
    if (!usable.length) return [];
    var seenCnt = {};
    done.forEach(function (d) { if (d.kind === kind) seenCnt[d.w] = (seenCnt[d.w] || 0) + 1; });
    var learned = usable.filter(function (w) { return w.status !== 'new'; });
    var pickFrom = learned.length >= 4 ? learned : usable;   // 还没学过词就先拿全库练
    pickFrom = pickFrom.slice().sort(function (a, b) {
      var da = seenCnt[a.w] || 0, db = seenCnt[b.w] || 0;
      if (da !== db) return da - db;
      return (a.due || 0) - (b.due || 0);
    });
    var chosen = pickFrom.slice(0, Math.max(n, 4));
    chosen = shuffle(chosen).slice(0, n);
    return chosen.map(function (w) { return buildItem(kind, w, usable); });
  });
}

function logDrill(item, ok, score) {
  var rec = {
    w: item.w.w, kind: item.kind, dim: item.dim,
    ok: !!ok, score: score == null ? (ok ? 100 : 0) : Math.round(score), ts: Date.now()
  };
  return dbPut('drills', rec)
    .then(function () { return bumpLog('drills'); })
    .then(function () { return ok ? bumpLog('correct') : null; });
}

/* 能力面板：近 60 天，三周半衰加权 */
function ability() {
  return dbAll('drills').then(function (rows) {
    var now = Date.now(), out = {};
    DIMS.forEach(function (d) { out[d] = { sum: 0, wgt: 0, n: 0, score: null }; });
    rows.forEach(function (r) {
      var age = (now - r.ts) / DAY;
      if (age > 60) return;
      var o = out[r.dim]; if (!o) return;
      var k = Math.exp(-age / 21);
      o.sum += (r.score || 0) * k; o.wgt += k; o.n++;
    });
    DIMS.forEach(function (d) {
      var o = out[d];
      o.score = o.wgt > 0 ? Math.round(o.sum / o.wgt) : null;
    });
    return out;
  });
}

/* ═══════════════════════════════════════════════════════════════════
   界面
   ═══════════════════════════════════════════════════════════════════ */
function $(id) { return document.getElementById(id); }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

var toastT;
function toast(msg) {
  var t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 1900);
}

function showScreen(name) {
  ['today', 'practice', 'library', 'stats', 'settings', 'drill'].forEach(function (n) {
    var s = $('screen-' + n); if (s) s.classList.toggle('active', n === name);
  });
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
  var bar = document.querySelector('.tabbar'); if (bar) bar.hidden = (name === 'drill');
  var fab = $('fab-add'); if (fab) fab.hidden = (name !== 'library');
  if (name === 'today')    renderToday();
  if (name === 'practice') renderPractice();
  if (name === 'library')  renderLibrary();
  if (name === 'stats')    renderStats();
}

/* ───────── 今日 / 复习：闪卡 ───────── */
var queue = [], qi = 0, mode = 'new';   // new | review
var queueBase = 0, queueGoal = 0;      // 今天已学几个 / 今天目标几个 —— 序号要接着数
var seenRound = {};                    // 本轮已评过的词；忘了的会回到队尾，再见到时标「再来一次」

function setCard(w, idx, total, again) {
  $('w-pos').textContent  = w.pos || '—';
  $('w-word').textContent = w.w;
  $('w-phon').textContent = w.p || '';
  /* 忘了的词会回到队尾。再见到它时直说「再来一次」，
     比让分母莫名其妙从 10 变 11 清楚得多。 */
  $('cf-idx').innerHTML = again
    ? '<span class="again-tag">再来一次</span>'
    : '第 <span id="w-idx" class="num">' + idx + '</span> / <span id="w-total" class="num">' + total + '</span> 词';
  $('b-word').textContent = w.w;
  $('b-def').textContent  = w.d || '（还没填释义）';
  var exBox = $('b-ex-box');
  if (w.ex) { exBox.hidden = false; $('b-ex').textContent = w.ex; $('b-tr').textContent = w.tr || ''; }
  else exBox.hidden = true;
  var mn = w.mn || {}, has = mn.root || mn.hook || mn.confuse;
  $('mn-box').hidden = !has;
  if (has) {
    $('mn-root').textContent    = mn.root || '';
    $('mn-root').parentNode.hidden = !mn.root;
    $('mn-hook').textContent    = mn.hook || '';
    $('mn-hook').parentNode.hidden = !mn.hook;
    $('mn-confuse').textContent = mn.confuse || '';
    $('mn-confuse').parentNode.hidden = !mn.confuse;
  }
  var cb = $('coll-box'), list = w.coll || [];
  cb.hidden = !list.length;
  if (list.length) $('coll-list').innerHTML = list.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
  $('flashcard').classList.remove('flipped');
}

function renderToday() {
  return Promise.all([getTodayNewWords(), dbGet('logs', dayKey()), dbAll('logs')]).then(function (r) {
    var news = r[0], log = r[1] || blankLog(dayKey()), logs = r[2] || [];
    var goal = S.dailyNew || 10, done = Math.min(log.learned || 0, goal);
    $('progress-num').textContent = done + ' / ' + goal;
    $('progress-fill').style.width = (goal ? done / goal * 100 : 0) + '%';
    var st = streak(logs);
    $('streak-txt').textContent = '连续 ' + st + ' 天';
    var d = new Date();
    $('head-date').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + '日一二三四五六'[d.getDay()];
    mode = 'new'; queue = news; qi = 0;
    seenRound = {};
    queueBase = Math.min(log.learned || 0, goal); queueGoal = goal;
    paintQueue('今天的新词都学完了', '去「练习」把学过的词过一遍，或明天再来');
  });
}
function startReview() {
  return getDueReviews().then(function (list) {
    if (!list.length) { toast('现在没有到期的词'); return; }
    mode = 'review'; queue = list; qi = 0; queueBase = 0; queueGoal = 0;
    seenRound = {};
    showScreen('today');
    $('card-mode').textContent = '复习';
    paintQueue('这一轮复习做完了', '下一批到期会自动排进来');
  });
}
function paintQueue(doneTitle, doneSub) {
  var deck = $('deck'), acts = $('card-actions'), dp = $('done-panel');
  $('card-mode').textContent = mode === 'review' ? '复习' : '今日新词';
  $('btn-fuzzy').hidden = (mode !== 'review');
  if (qi >= queue.length) {
    deck.hidden = true; acts.hidden = true; $('flip-hint').hidden = true;
    dp.hidden = false;
    $('done-title').textContent = doneTitle; $('done-sub').textContent = doneSub;
    return;
  }
  deck.hidden = false; acts.hidden = false; $('flip-hint').hidden = false; dp.hidden = true;
  deck.setAttribute('data-left', String(Math.max(0, queue.length - qi - 1)));
  /* 新词模式下序号接着今天已学的数走，跟上面的「x / 目标」对得上；
     忘了的词会回到队尾，分母跟着变大，这是实话。 */
  var w = queue[qi];
  var again = !!seenRound[w.w];
  var total = mode === 'review' ? queue.length : Math.max(queueGoal, queueBase + queue.length);
  setCard(w, queueBase + qi + 1, total, again);
}
function grade(g) {
  if (qi >= queue.length) return;
  var w = queue[qi];
  var wasNew = (w.status === 'new');
  seenRound[w.w] = 1;
  (wasNew ? firstLearn(w, g === 2) : schedule(w, g));
  dbPut('words', w)
    .then(function () { return bumpLog(wasNew ? 'learned' : 'reviewed'); })
    .then(function () { return logDrill({ kind: 'recall', w: w, dim: '认词' }, g === 2, g === 2 ? 100 : (g === 1 ? 55 : 0)); })
    .then(function () { renderTodayCounterOnly(); queueSyncSoon(); });
  if (g === 0) { var again = w; qi++; queue.push(again); }   // 忘了就放回队尾，当轮再见一次
  else qi++;
  paintQueue(mode === 'review' ? '这一轮复习做完了' : '今天的新词都学完了',
             mode === 'review' ? '下一批到期会自动排进来' : '去「练习」把学过的词过一遍');
}
function renderTodayCounterOnly() {
  dbGet('logs', dayKey()).then(function (log) {
    log = log || blankLog(dayKey());
    var goal = S.dailyNew || 10, done = Math.min(log.learned || 0, goal);
    $('progress-num').textContent = done + ' / ' + goal;
    $('progress-fill').style.width = (goal ? done / goal * 100 : 0) + '%';
  });
}

/* ───────── 练习页 ───────── */
function renderPractice() {
  return Promise.all([getDueReviews(), dbAll('words'), dbAll('drills')]).then(function (r) {
    var due = r[0], words = r[1], drills = r[2];
    $('review-count').textContent = due.length;
    var wrong = words.filter(function (w) { return w.status === 'learning' || (w.ef || 2.5) < 2.2; });
    $('wrong-count').textContent = wrong.length + ' 个需要加强的词';
    var cnt = {};
    drills.forEach(function (d) { cnt[d.kind] = (cnt[d.kind] || 0) + 1; });
    var box = $('drill-list'); box.innerHTML = '';
    Object.keys(DRILL).forEach(function (kind) {
      var def = DRILL[kind];
      var ok = words.filter(def.need);
      var learned = ok.filter(function (w) { return w.status !== 'new'; });
      var n = learned.length >= 4 ? learned.length : ok.length;
      var row = el('button', 'drill-row');
      row.innerHTML =
        '<span class="drill-dim">' + esc(def.dim) + '</span>' +
        '<span class="drill-main"><span class="drill-name">' + esc(def.label) + '</span>' +
        '<span class="drill-hint">' + esc(def.hint) + '</span></span>' +
        '<span class="drill-n num">' + n + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      row.disabled = n < 1;
      row.addEventListener('click', function () { startDrill(kind); });
      box.appendChild(row);
    });
  });
}

/* ───────── 练习运行器 ───────── */
var dset = [], di = 0, dkind = '', dstat = { ok: 0, n: 0 };

function startDrill(kind) {
  if (kind === 'speak' && !SR && !('speechSynthesis' in window)) { toast('这台设备不支持语音'); return; }
  makeDrillSet(kind, S.drillLen || 10).then(function (items) {
    if (!items.length) { toast('这个题型还没有可练的词'); return; }
    dset = items; di = 0; dkind = kind; dstat = { ok: 0, n: 0 };
    showScreen('drill');
    paintDrill();
  });
}
function paintDrill() {
  var head = $('drill-title'), prog = $('drill-prog');
  head.textContent = DRILL[dkind].label;
  if (di >= dset.length) return finishDrill();
  prog.textContent = (di + 1) + ' / ' + dset.length;
  $('drill-fill').style.width = (di / dset.length * 100) + '%';
  var it = dset[di], b = $('drill-body');
  b.innerHTML = '';
  $('drill-feedback').hidden = true;
  $('drill-next').hidden = true;

  if (it.speakMode) return paintSpeak(it, b);

  // 题干
  var q = el('div', 'd-q');
  if (it.kind === 'cloze') {
    q.innerHTML = esc(it.q).replace('____', '<span class="d-blank">？</span>');
  } else if (it.kind === 'listen' || it.kind === 'spell') {
    q.innerHTML = '<button class="d-play" id="d-play"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.6 5.6a9 9 0 0 1 0 12.8"/></svg>再播一次</button>'
      + (it.kind === 'spell' ? '<div class="d-sub">' + esc(it.q) + '</div>' : '');
  } else {
    q.textContent = it.q;
  }
  b.appendChild(q);
  if (it.sub && it.kind !== 'spell') { b.appendChild(el('div', 'd-sub', esc(it.sub))); }

  if (it.typed) {
    var wrap = el('div', 'd-type');
    wrap.innerHTML = '<input id="d-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="' +
      (it.kind === 'spell' ? '拼出这个词' : '填入这个词') + '" />' +
      '<button class="btn btn-primary" id="d-submit">确定</button>';
    b.appendChild(wrap);
    var tip = el('button', 'd-tip', '想不起来？给个首字母');
    tip.addEventListener('click', function () {
      var inp = $('d-input'); inp.value = it.answer.slice(0, 1); inp.focus();
      tip.disabled = true; tip.textContent = '首字母是 ' + it.answer.slice(0, 1).toUpperCase();
    });
    b.appendChild(tip);
    setTimeout(function () {
      $('d-submit').addEventListener('click', function () { judge(it, $('d-input').value); });
      $('d-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') judge(it, this.value); });
      $('d-input').focus();
    }, 0);
  } else {
    var ol = el('div', 'd-opts');
    it.opts.forEach(function (opt) {
      var btn = el('button', 'd-opt', esc(opt));
      btn.addEventListener('click', function () { judge(it, opt, btn); });
      ol.appendChild(btn);
    });
    b.appendChild(ol);
  }
  if (it.say) {
    setTimeout(function () {
      var p = $('d-play'); if (p) p.addEventListener('click', function () { speak(it.say); });
      if (S.autoSpeak) speak(it.say);
    }, 60);
  }
}

function judge(it, given, btn) {
  var ok;
  if (it.typed) {
    ok = tokens(given).join(' ') === tokens(it.answer).join(' ');
  } else {
    ok = (given === it.answer);
  }
  dstat.n++; if (ok) dstat.ok++;
  buzz(ok ? 10 : [8, 30, 8]);
  logDrill(it, ok, ok ? 100 : 0);

  var opts = document.querySelectorAll('.d-opt');
  opts.forEach(function (b2) {
    b2.disabled = true;
    if (b2.textContent === it.answer) b2.classList.add('right');
    // 两选一（哪个更地道）：另一句一定要标红，对比才学得到
    else if (b2 === btn || opts.length === 2) b2.classList.add('wrong');
  });
  var inp = $('d-input'); if (inp) { inp.disabled = true; inp.classList.add(ok ? 'right' : 'wrong'); }
  var sub = $('d-submit'); if (sub) sub.disabled = true;

  var fb = $('drill-feedback');
  fb.className = 'd-fb ' + (ok ? 'ok' : 'bad');
  var html = '<div class="d-fb-h">' + (ok ? '对' : '再看一眼') + '</div>';
  if (!ok) html += '<div class="d-fb-a">' + esc(it.answer) + '</div>';
  if (it.why) html += '<div class="d-fb-why">' + esc(it.why) + '</div>';
  if (it.kind === 'cloze' && it.sub) html += '<div class="d-fb-why">' + esc(it.sub) + '</div>';
  if (it.kind === 'spell' || it.kind === 'choice' || it.kind === 'listen') {
    html += '<div class="d-fb-why">' + esc(it.w.w) + '　' + esc(it.w.p) + '　' + esc(it.w.d) + '</div>';
  }
  if (!ok && it.w.mn && it.w.mn.hook) html += '<div class="d-fb-why">助记　' + esc(it.w.mn.hook) + '</div>';
  fb.innerHTML = html; fb.hidden = false;
  $('drill-next').hidden = false;
  $('drill-next').textContent = (di + 1 >= dset.length) ? '看结果' : '下一题';
}

function paintSpeak(it, b) {
  b.innerHTML =
    '<div class="d-sub">跟读这句</div>' +
    '<div class="d-say" id="d-say">' + it.q.split(/\s+/).map(function (t, i) { return '<span data-i="' + i + '">' + esc(t) + '</span>'; }).join(' ') + '</div>' +
    '<div class="d-sub">' + esc(it.sub || '') + '</div>' +
    '<div class="d-speak-row">' +
      '<button class="btn btn-ghost" id="d-play">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/>' +
        '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.6 5.6a9 9 0 0 1 0 12.8"/></svg>范读</button>' +
      '<button class="btn btn-primary" id="d-rec">按一下，开始读</button>' +
    '</div>' +
    '<div class="d-heard" id="d-heard" hidden></div>';
  setTimeout(function () {
    $('d-play').addEventListener('click', function () { speak(it.say, 0.85); });
    $('d-rec').addEventListener('click', function () { doSpeak(it); });
    if (S.autoSpeak) speak(it.say, 0.85);
  }, 60);
}
function showSelfRate(it, why) {
  var h = $('d-heard'); h.hidden = false;
  h.innerHTML = '<div class="d-sub">' + esc(why) + '改成自评：再听一遍范读，和自己刚才读的比一比。</div>' +
    '<div class="d-selfrate"><button data-s="40">没读顺</button><button data-s="70">基本读对</button><button data-s="95">很流畅</button></div>';
  h.querySelectorAll('.d-selfrate button').forEach(function (b2) {
    b2.addEventListener('click', function () {
      var sc = +b2.getAttribute('data-s');
      dstat.n++; if (sc >= 70) dstat.ok++;
      logDrill(it, sc >= 70, sc);
      showSpeakResult(it, { score: sc, marks: null, heard: '（自评）' });
    });
  });
}
function doSpeak(it) {
  var btn = $('d-rec');
  if (!SR) { showSelfRate(it, '这台设备不支持语音识别。'); return; }
  btn.disabled = true; btn.textContent = '在听…　说完会自动停';
  btn.classList.add('listening');
  listenOnce(7000).then(function (alts) {
    var res = scoreSpeech(it.answer, alts);
    dstat.n++; if (res.score >= 70) dstat.ok++;
    buzz(res.score >= 70 ? 12 : [8, 30, 8]);
    logDrill(it, res.score >= 70, res.score);
    showSpeakResult(it, res);
  }).catch(function (e) {
    btn.disabled = false; btn.classList.remove('listening'); btn.textContent = '再读一次';
    var m = String(e && e.message || e);
    var why = m === 'not-allowed' ? '拿不到麦克风权限。' :
              m === 'no-speech'   ? '没听到声音。' :
              m === 'network'     ? '语音识别要联网，现在连不上。' :
              m === 'no-sr'       ? '这台设备不支持语音识别。' : '识别失败（' + m + '）。';
    toast(why.replace(/。$/, ''));
    showSelfRate(it, why);          // 识别走不通也要能把这题做完
  });
}
function showSpeakResult(it, res) {
  var btn = $('d-rec'); btn.disabled = false; btn.classList.remove('listening'); btn.textContent = '再读一次';
  if (res.marks) {
    var spans = $('d-say').querySelectorAll('span');
    var T = res.tokens, ti = 0;
    // 把打分标记按词映射回原句（原句带标点，token 已去标点）
    for (var i = 0; i < spans.length; i++) {
      var t = tokens(spans[i].textContent);
      if (!t.length) continue;
      spans[i].className = res.marks[ti] ? 'hit' : 'miss';
      ti += t.length;
    }
  }
  var h = $('d-heard'); h.hidden = false;
  h.innerHTML =
    '<div class="d-score"><b class="num">' + res.score + '</b><span>分</span></div>' +
    '<div class="d-sub">识别到：' + esc(res.heard || '（空）') + '</div>' +
    (res.marks ? '<div class="d-sub">标红的词没被识别出来，多半是那里没读清。</div>' : '');
  $('drill-next').hidden = false;
  $('drill-next').textContent = (di + 1 >= dset.length) ? '看结果' : '下一题';
}

function finishDrill() {
  var pct = dstat.n ? Math.round(dstat.ok / dstat.n * 100) : 0;
  $('drill-prog').textContent = '';
  $('drill-fill').style.width = '100%';
  $('drill-body').innerHTML =
    '<div class="done-panel">' +
      '<div class="done-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' +
      '<h3>答对 ' + dstat.ok + ' / ' + dstat.n + '</h3>' +
      '<p>' + DRILL[dkind].label + '　正确率 ' + pct + '%　·　已记入「' + DRILL[dkind].dim + '」</p>' +
    '</div>';
  $('drill-feedback').hidden = true;
  $('drill-next').hidden = false;
  $('drill-next').textContent = '回练习页';
  queueSyncSoon();
}

/* ───────── 词库 ───────── */
var libTag = '全部', libQ = '';
function renderLibrary() {
  return dbAll('words').then(function (words) {
    var tags = {}; words.forEach(function (w) { (w.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
    var order = ['全部', '收藏'].concat(Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 8));
    if (libTag !== '全部' && order.indexOf(libTag) < 0) order.push(libTag);
    var cr = $('chip-row');
    if (cr.getAttribute('data-built') !== order.join()) {
      cr.setAttribute('data-built', order.join());
      cr.innerHTML = order.map(function (t) {
        return '<button class="chip' + (t === libTag ? ' active' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('');
    }
    var q = libQ.trim().toLowerCase();
    var rows = words.filter(function (w) {
      if (libTag === '收藏' && !w.fav) return false;
      if (libTag !== '全部' && libTag !== '收藏' && (w.tags || []).indexOf(libTag) < 0) return false;
      if (!q) return true;
      return w.w.toLowerCase().indexOf(q) > -1 || (w.d || '').indexOf(q) > -1;
    }).sort(byOrd);
    $('lib-sub').textContent = '共 ' + rows.length + ' 词 · ' + libTag;
    var STATUS = { 'new': ['未学', ''], learning: ['学习中', 'warn'], review: ['复习中', ''], known: ['已掌握', 'ok'] };
    $('word-list').innerHTML = rows.map(function (w) {
      var st = STATUS[w.status] || ['', ''];
      return '<li class="wrow" data-w="' + esc(w.w) + '">' +
        '<div class="wrow-main">' +
          '<div class="wrow-top"><span class="wrow-word">' + esc(w.w) + '</span>' +
          '<span class="wrow-pos">' + esc(w.pos) + '</span></div>' +
          '<span class="wrow-phon">' + esc(w.p) + '</span>' +
          '<div class="wrow-def">' + esc(w.d) + '</div>' +
        '</div>' +
        (st[1] ? '<span class="review-tag ' + st[1] + '">' + st[0] + '</span>' : '') +
        '<button class="star' + (w.fav ? ' active' : '') + '" aria-label="收藏">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">' +
        '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></button></li>';
    }).join('') || '<li class="wrow"><div class="wrow-main"><div class="wrow-def">这里还没有词</div></div></li>';
  });
}

/* ───────── 统计 + 能力面板 ───────── */
function renderStats() {
  return Promise.all([dbAll('words'), dbAll('logs'), ability()]).then(function (r) {
    var words = r[0], logs = r[1], ab = r[2];
    var known = words.filter(function (w) { return w.status === 'known'; }).length;
    var learn = words.filter(function (w) { return w.status === 'learning' || w.status === 'review'; }).length;
    var fresh = words.filter(function (w) { return w.status === 'new'; }).length;
    var touched = known + learn;
    $('stat-total').textContent  = touched;
    $('stat-streak').textContent = streak(logs);
    $('stat-known').textContent  = known;
    $('stat-learn').textContent  = learn;

    // 近 7 天
    var map = {}; logs.forEach(function (l) { map[l.date] = l; });
    var days = [], max = 1;
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var l = map[dayKey(d)] || blankLog('');
      var v = (l.learned || 0) + (l.reviewed || 0);
      max = Math.max(max, v);
      days.push({ v: v, lbl: '日一二三四五六'[d.getDay()], today: i === 0 });
    }
    $('week-total').textContent = days.reduce(function (a, b) { return a + b.v; }, 0) + ' 词';
    $('bars').innerHTML = days.map(function (d) {
      return '<div class="bar-col' + (d.today ? ' today' : '') + '">' +
        '<span class="bar-val">' + (d.v || '') + '</span>' +
        '<div class="bar' + (d.today ? ' today' : '') + '" style="height:' + Math.round(d.v / max * 100) + '%"></div>' +
        '<span class="bar-lbl">' + d.lbl + '</span></div>';
    }).join('');

    // 能力面板：同一个量纲，统一墨色；最弱项用印章红 + 文字标注（不靠颜色单独表意）
    var scored = DIMS.filter(function (k) { return ab[k].score != null; });
    var weakest = null;
    scored.forEach(function (k) { if (!weakest || ab[k].score < ab[weakest].score) weakest = k; });
    $('ability-list').innerHTML = DIMS.map(function (k) {
      var o = ab[k], has = o.score != null, isWeak = has && k === weakest && scored.length > 1;
      return '<div class="ab-row' + (isWeak ? ' weak' : '') + '">' +
        '<span class="ab-name">' + k + '</span>' +
        '<div class="ab-bar"><div class="ab-fill" style="width:' + (has ? o.score : 0) + '%"></div></div>' +
        '<span class="ab-val num">' + (has ? o.score : '—') + '</span>' +
        '<span class="ab-tag">' + (isWeak ? '最弱' : (has ? '' : '没练过')) + '</span>' +
        '</div>';
    }).join('');
    var adv = $('ability-advice');
    if (!scored.length) adv.textContent = '去「练习」做几组题，这里就会出分。';
    else if (scored.length < DIMS.length) {
      var missing = DIMS.filter(function (k) { return ab[k].score == null; });
      adv.textContent = '还没练过：' + missing.join('、') + '。五项都练过才看得出短板。';
    } else {
      adv.textContent = '最弱的是「' + weakest + '」（' + ab[weakest].score + ' 分，' + ab[weakest].n + ' 次）。' +
        '建议这周多做' + DIMS.filter(function (k) { return k === weakest; }).map(function (k) {
          return Object.keys(DRILL).filter(function (x) { return DRILL[x].dim === k; }).map(function (x) { return '「' + DRILL[x].label + '」'; }).join('');
        })[0] + '。';
    }

    // 掌握度（状态色，和能力面板的墨色分工不同）
    var tot = Math.max(1, known + learn + fresh);
    $('seg-breakdown').innerHTML = [
      ['已掌握', known, 'ok'], ['学习中', learn, 'warn'], ['未学', fresh, 'danger']
    ].map(function (s) {
      return '<div class="seg-row"><span class="dot" style="background:var(--' + s[2] + ')"></span>' +
        '<span class="seg-name">' + s[0] + '</span><div class="seg-bar">' +
        '<div class="seg-fill" style="width:' + (s[1] / tot * 100) + '%;background:var(--' + s[2] + ')"></div></div>' +
        '<span class="num seg-n">' + s[1] + '</span></div>';
    }).join('');
  });
}

/* ───────── 查词 ───────── */
function lookup(word) {
  if (!API) return Promise.reject(new Error('没填后端地址'));
  return fetch(API + '/lookup?word=' + encodeURIComponent(word)).then(function (r) { return r.json(); });
}
/* 给生词补助记和例句（后端 /enrich，没配就静默跳过） */
function enrich(word) {
  if (!API) return Promise.reject(new Error('no-api'));
  return fetch(API + '/enrich?word=' + encodeURIComponent(word)).then(function (r) { return r.json(); });
}

/* ───────── 推送订阅 ───────── */
function u8(base64) {
  var pad2 = '='.repeat((4 - base64.length % 4) % 4);
  var b = atob((base64 + pad2).replace(/-/g, '+').replace(/_/g, '/'));
  var a = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
function subscribePush(on) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return Promise.reject(new Error('这台设备不支持网页推送'));
  if (!API || !CFG.VAPID_PUBLIC_KEY) return Promise.reject(new Error('还没配后端地址或 VAPID 公钥'));
  return navigator.serviceWorker.ready.then(function (reg) {
    if (!on) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return;
        return fetch(API + '/subscribe?remove=1', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        }).then(function () { return sub.unsubscribe(); });
      });
    }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('你拒绝了通知权限');
      return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(CFG.VAPID_PUBLIC_KEY) });
    }).then(function (sub) {
      return fetch(API + '/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(), token: S.syncToken || '',
          tzOffset: -new Date().getTimezoneOffset() / 60,
          activeStart: S.activeStart, activeEnd: S.activeEnd, intervalMin: S.intervalMin
        })
      });
    });
  });
}

/* ───────── 多设备同步（LWW） ───────── */
var syncT;
function queueSyncSoon() { if (!S.syncToken || !API) return; clearTimeout(syncT); syncT = setTimeout(syncNow, 8000); }
function syncNow() {
  if (!S.syncToken || !API) return Promise.reject(new Error('没填同步口令或后端地址'));
  return dbAll('words').then(function (local) {
    return fetch(API + '/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: S.syncToken, words: local })
    }).then(function (r) { return r.json(); }).then(function (res) {
      var remote = res.words || [], byKey = {};
      local.forEach(function (w) { byKey[w.w.toLowerCase()] = w; });
      var put = [];
      remote.forEach(function (rw) {
        var cur = byKey[String(rw.w || '').toLowerCase()];
        if (!cur || (rw.updatedAt || 0) > (cur.updatedAt || 0)) put.push(rw);
      });
      return dbPutMany('words', put).then(function () { return put.length; });
    });
  });
}

/* ───────── 导入导出 ───────── */
function toCSV(words) {
  var head = ['word', 'phonetic', 'pos', 'meaning', 'example', 'translation', 'tags', 'status', 'due'];
  var q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
  return head.join(',') + '\n' + words.map(function (w) {
    return [w.w, w.p, w.pos, w.d, w.ex, w.tr, (w.tags || []).join('|'), w.status,
            w.due ? new Date(w.due).toISOString().slice(0, 10) : ''].map(q).join(',');
  }).join('\n');
}
function parseCSV(text) {
  var rows = [], cur = [], f = '', inQ = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') inQ = false;
      else f += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  return rows.filter(function (r) { return r.length && r.join('').trim(); });
}
function importText(text) {
  var rows = parseCSV(text);
  if (!rows.length) return Promise.resolve(0);
  var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var isCSV = head.indexOf('word') > -1;
  var items = [];
  (isCSV ? rows.slice(1) : rows).forEach(function (r) {
    if (isCSV) {
      items.push({ w: r[0], p: r[1], pos: r[2], d: r[3], ex: r[4], tr: r[5], tags: (r[6] || '').split('|').filter(Boolean) });
    } else {
      var line = r.join(',').trim();
      var m = line.split(/[\t,，\s]{1,}/);
      if (m[0]) items.push({ w: m[0], d: m.slice(1).join(' ') });
    }
  });
  items = items.filter(function (x) { return x.w && /[a-zA-Z]/.test(x.w); });
  return dbAll('words').then(function (have) {
    var byKey = {}; have.forEach(function (x) { byKey[x.w.toLowerCase()] = x; });
    var maxOrd = have.reduce(function (a, b) { return Math.max(a, b.ord || 0); }, 0);
    var out = [];
    items.forEach(function (it, i) {
      var k = String(it.w).trim().toLowerCase();
      if (byKey[k]) return;
      out.push(normWord(it, maxOrd + 1 + i));
      byKey[k] = 1;
    });
    return dbPutMany('words', out).then(function () { return out.length; });
  });
}
function download(name, text) {
  var b = new Blob([text], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ───────── 甩卡手势 ───────── */
function wireSwipe() {
  var card = $('flashcard'), deck = $('deck');
  if (!card || !deck) return;
  var yes = deck.querySelector('.throw-yes'), no = deck.querySelector('.throw-no');
  var TH = 86, sx = 0, sy = 0, dx = 0, dy = 0, down = false, drag = false, lock = false, swallow = false;

  function paint(x) {
    card.style.transform = 'translateX(' + x + 'px) rotate(' + (x / 20) + 'deg)';
    var p = Math.min(Math.abs(x) / TH, 1);
    if (yes) yes.style.opacity = x > 0 ? p : 0;
    if (no) no.style.opacity = x < 0 ? p : 0;
  }
  function reset() { card.style.transform = ''; card.style.opacity = ''; if (yes) yes.style.opacity = 0; if (no) no.style.opacity = 0; }
  function spring() { card.classList.add('settle'); reset(); setTimeout(function () { card.classList.remove('settle'); }, 470); }

  card.addEventListener('pointerdown', function (e) {
    if (lock || (e.target.closest && e.target.closest('#speaker'))) return;
    down = true; drag = false; dx = dy = 0; sx = e.clientX; sy = e.clientY;
    card.classList.remove('throwing', 'settle');
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
  });
  card.addEventListener('pointermove', function (e) {
    if (!down) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (!drag) {
      if (Math.abs(dx) < 7) return;
      if (Math.abs(dx) < Math.abs(dy)) { down = false; return; }
      drag = true;
    }
    e.preventDefault(); paint(dx);
  });
  function release() {
    if (!down) return;
    down = false;
    if (!drag) return;
    swallow = true;
    if (Math.abs(dx) <= TH) { spring(); return; }
    lock = true;
    var dir = dx > 0 ? 1 : -1;
    card.classList.add('throwing');
    card.style.transform = 'translateX(' + (dir * 480) + 'px) rotate(' + (dir * 26) + 'deg)';
    card.style.opacity = 0;
    buzz(dir > 0 ? 14 : [9, 26, 9]);
    setTimeout(function () {
      grade(dir > 0 ? 2 : 0);
      card.classList.remove('throwing', 'flipped');
      reset(); card.classList.add('settle');
      setTimeout(function () { card.classList.remove('settle'); lock = false; }, 320);
    }, 300);
  }
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', function () { down = false; drag = false; spring(); });
  card.addEventListener('click', function (e) {
    if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); return; }
    if (e.target.closest && e.target.closest('#speaker')) return;
    card.classList.toggle('flipped');
  }, true);
  card.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); grade(2); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); grade(0); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); card.classList.toggle('flipped'); }
  });
}

/* ───────── 事件绑定 ───────── */
function wire() {
  wireSwipe();

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showScreen(t.getAttribute('data-tab')); });
  });
  $('speaker').addEventListener('click', function (e) {
    e.stopPropagation();
    var w = queue[qi]; if (w && !speak(w.w)) toast('这台设备不支持朗读');
  });
  $('btn-ok').addEventListener('click', function () { grade(2); });
  $('btn-fuzzy').addEventListener('click', function () { grade(1); });
  $('btn-no').addEventListener('click', function () { grade(0); });
  $('btn-speak-ex').addEventListener('click', function (e) {
    e.stopPropagation(); var w = queue[qi]; if (w && w.ex) speak(w.ex, 0.85);
  });
  $('done-again').addEventListener('click', function () { showScreen('practice'); });

  $('btn-start-review').addEventListener('click', startReview);
  $('btn-wrong').addEventListener('click', function () {
    dbAll('words').then(function (ws) {
      var list = ws.filter(function (w) { return w.status === 'learning' || (w.ef || 2.5) < 2.2; })
                   .sort(function (a, b) { return (a.ef || 2.5) - (b.ef || 2.5); });
      if (!list.length) { toast('错词本是空的，不错'); return; }
      mode = 'review'; queue = list.slice(0, 20); qi = 0; queueBase = 0; queueGoal = 0;
      seenRound = {};
      showScreen('today'); paintQueue('错词过完了', '这些词的间隔已经重排');
    });
  });

  $('drill-exit').addEventListener('click', function () { showScreen('practice'); });
  $('drill-next').addEventListener('click', function () {
    if (di >= dset.length) { showScreen('practice'); return; }
    di++; paintDrill();
  });

  $('search-input').addEventListener('input', function () { libQ = this.value; renderLibrary(); });
  $('chip-row').addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (!c) return;
    libTag = c.getAttribute('data-tag');
    this.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('active', x === c); });
    renderLibrary();
  });
  $('word-list').addEventListener('click', function (e) {
    var li = e.target.closest('.wrow'); if (!li) return;
    var key = li.getAttribute('data-w'); if (!key) return;
    if (e.target.closest('.star')) {
      dbGet('words', key).then(function (w) {
        if (!w) return;
        w.fav = !w.fav; w.updatedAt = Date.now();
        return dbPut('words', w).then(function () {
          li.querySelector('.star').classList.toggle('active', w.fav);
          toast(w.fav ? '已收藏' : '取消收藏'); queueSyncSoon();
        });
      });
    } else {
      dbGet('words', key).then(function (w) { if (w) speak(w.w); });
    }
  });

  $('fab-add').addEventListener('click', function () { $('overlay').hidden = false; $('add-word').focus(); });
  $('add-cancel').addEventListener('click', function () { $('overlay').hidden = true; });
  $('overlay').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('add-lookup').addEventListener('click', function () {
    var w = $('add-word').value.trim();
    if (!w) { toast('先填单词'); return; }
    var b = this; b.disabled = true; b.textContent = '查询中…';
    lookup(w).then(function (r) {
      if (r.p) $('add-phon').value = r.p;
      if (r.d) $('add-def').value = r.d;
      if (r.ex) $('add-ex').value = r.ex;
      toast(r.d ? '已补全' : '没查到中文释义，手动填一下');
    }).catch(function (e) { toast('查词失败：' + e.message); })
      .then(function () { b.disabled = false; b.textContent = '联网查词补全'; });
  });
  $('add-save').addEventListener('click', function () {
    var w = $('add-word').value.trim();
    if (!w) { toast('先填单词'); return; }
    dbGet('words', w).then(function (ex0) {
      if (ex0) { toast('这个词已经在库里了'); return; }
      return dbAll('words').then(function (all) {
        var maxOrd = all.reduce(function (a, b) { return Math.max(a, b.ord || 0); }, 0);
        var nw = normWord({ w: w, p: $('add-phon').value.trim(), d: $('add-def').value.trim(), ex: $('add-ex').value.trim(), tags: ['我的'] }, maxOrd + 1);
        return dbPut('words', nw).then(function () {
          ['add-word', 'add-phon', 'add-def', 'add-ex'].forEach(function (id) { $(id).value = ''; });
          $('overlay').hidden = true; toast('已加入词库'); queueSyncSoon(); renderLibrary();
          // 后台补助记，配了 /enrich 才有
          enrich(w).then(function (r) {
            if (!r || !r.mn) return;
            return dbGet('words', w).then(function (cur) {
              if (!cur) return;
              cur.mn = r.mn || cur.mn; if (r.coll) cur.coll = r.coll;
              if (r.nat) cur.nat = r.nat; if (r.blank) cur.blank = r.blank;
              cur.updatedAt = Date.now();
              return dbPut('words', cur).then(function () { toast('「' + w + '」的助记也补好了'); });
            });
          }).catch(function () {});
        });
      });
    });
  });

  // 设置
  $('toggle-push').addEventListener('click', function () {
    var on = !this.classList.contains('on'), btn = this;
    subscribePush(on).then(function () {
      btn.classList.toggle('on', on); btn.setAttribute('aria-checked', on ? 'true' : 'false');
      setS('pushEnabled', on);
      toast(on ? '推送已开 · 活跃时段内每 ' + S.intervalMin + ' 分钟一个词' : '推送已关');
    }).catch(function (e) { toast(e.message); });
  });
  $('toggle-theme').addEventListener('click', function () {
    var on = !this.classList.contains('on');
    this.classList.toggle('on', on); this.setAttribute('aria-checked', on ? 'true' : 'false');
    applyTheme(on ? 'dark' : 'light'); setS('theme', on ? 'dark' : 'light');
  });
  $('toggle-autospeak').addEventListener('click', function () {
    var on = !this.classList.contains('on');
    this.classList.toggle('on', on); this.setAttribute('aria-checked', on ? 'true' : 'false');
    setS('autoSpeak', on);
  });
  $('step-dec').addEventListener('click', function () { var n = Math.max(5, (S.dailyNew || 10) - 5); setS('dailyNew', n); $('step-val').textContent = n; renderToday(); });
  $('step-inc').addEventListener('click', function () { var n = Math.min(50, (S.dailyNew || 10) + 5); setS('dailyNew', n); $('step-val').textContent = n; renderToday(); });
  ['interval-select', 'active-start', 'active-end'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var k = { 'interval-select': 'intervalMin', 'active-start': 'activeStart', 'active-end': 'activeEnd' }[id];
      setS(k, +this.value);
      if (S.pushEnabled) subscribePush(true).then(function () { toast('推送设置已更新'); }).catch(function () {});
    });
  });
  $('sync-token').addEventListener('change', function () { setS('syncToken', this.value.trim()); toast(this.value.trim() ? '同步口令已保存' : '已关闭同步'); });
  $('btn-sync').addEventListener('click', function () {
    var b = this; b.disabled = true;
    syncNow().then(function (n) { toast('同步完成，更新了 ' + n + ' 个词'); renderLibrary(); })
      .catch(function (e) { toast('同步失败：' + e.message); })
      .then(function () { b.disabled = false; });
  });
  $('btn-import').addEventListener('click', function () { $('file-input').click(); });
  $('file-input').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      importText(String(fr.result)).then(function (n) {
        toast(n ? '导入了 ' + n + ' 个新词' : '没有新词可导入');
        renderLibrary(); queueSyncSoon();
      }).catch(function (e) { toast('导入失败：' + e.message); });
    };
    fr.readAsText(f); this.value = '';
  });
  $('btn-export').addEventListener('click', function () {
    dbAll('words').then(function (ws) { download('拾词-' + dayKey() + '.csv', '﻿' + toCSV(ws.sort(byOrd))); toast('已导出 CSV'); });
  });
  $('btn-check-update').addEventListener('click', function () {
    var hint = $('update-hint');
    if (!navigator.serviceWorker || !window.__swReg) { toast('这个浏览器没有离线缓存，刷新即是最新'); return; }
    hint.textContent = '检查中…';
    window.__swReg.update().then(function () {
      if (window.__swReg.installing || window.__swReg.waiting) {
        hint.textContent = '已下载新版本，关掉 App 再打开就生效';
        toast('有新版本，关掉重开即可');
      } else {
        hint.textContent = '已是最新（' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 检查）';
        toast('已是最新版本');
      }
    }).catch(function (e) {
      hint.textContent = '检查失败，可能没联网';
      toast('检查更新失败：' + e.message);
    });
  });

  $('btn-reset-drills').addEventListener('click', function () {
    if (!confirm('清空练习记录？词库和学习进度不受影响。')) return;
    openDB().then(function (db) {
      var t = db.transaction('drills', 'readwrite');
      t.objectStore('drills').clear();
      t.oncomplete = function () { toast('练习记录已清空'); renderStats(); };
    });
  });

  document.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('.btn,.tab,.switch,.star,.stepper button,.fab,.chip,.d-opt,.drill-row')) buzz(6);
  }, { passive: true });
}

/* ───────── 主题 ───────── */
function applyTheme(t) {
  var p = $('phone');
  if (t === 'auto' || !t) p.removeAttribute('data-theme');
  else p.setAttribute('data-theme', t);
}

/* ───────── 启动 ───────── */
function fillSettingsUI() {
  $('step-val').textContent = S.dailyNew;
  $('interval-select').value = String(S.intervalMin);
  $('active-start').value = String(S.activeStart);
  $('active-end').value = String(S.activeEnd);
  $('sync-token').value = S.syncToken || '';
  $('toggle-push').classList.toggle('on', !!S.pushEnabled);
  $('toggle-push').setAttribute('aria-checked', S.pushEnabled ? 'true' : 'false');
  $('toggle-theme').classList.toggle('on', S.theme === 'dark');
  $('toggle-theme').setAttribute('aria-checked', S.theme === 'dark' ? 'true' : 'false');
  $('toggle-autospeak').classList.toggle('on', S.autoSpeak !== false);
  $('toggle-autospeak').setAttribute('aria-checked', S.autoSpeak !== false ? 'true' : 'false');
  $('cap-speech').textContent = SR ? '可用' : '这台设备不支持';
  $('cap-tts').textContent = ('speechSynthesis' in window) ? '可用' : '这台设备不支持';
  $('cap-version').textContent = 'v' + (window.SHICI_VERSION || '?');
  // 顺带问一下 Service Worker 自己是哪个版本 —— 两个对不上就说明缓存还没换过来
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      var ch = new MessageChannel();
      navigator.serviceWorker.controller.postMessage({ type: 'VERSION' }, [ch.port2]);
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'VERSION' && e.data.version !== window.SHICI_VERSION) {
          $('update-hint').textContent = '页面 v' + window.SHICI_VERSION + '，离线缓存还是 v' + e.data.version + '，关掉 App 重开一次即可';
        }
      });
    }
  } catch (e) {}
}

function boot() {
  loadSettings()
    .then(function () { applyTheme(S.theme); return seedIfNeeded(); })
    .then(function () { wire(); fillSettingsUI(); showScreen('today'); })
    .then(function () { if (S.syncToken && API) syncNow().then(function () { renderLibrary(); }).catch(function () {}); })
    .catch(function (e) {
      console.error(e);
      var b = document.querySelector('.screen-body');
      if (b) b.insertAdjacentHTML('afterbegin', '<div class="card" style="color:var(--danger)">启动失败：' + esc(e.message) + '</div>');
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* 调试用，正常不需要 */
window.SHICI = { dbAll: dbAll, dbPut: dbPut, ability: ability, scoreSpeech: scoreSpeech, S: S, syncNow: syncNow };

})();
