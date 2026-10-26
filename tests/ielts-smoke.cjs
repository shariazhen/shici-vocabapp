// Start python3 -m http.server 8081 at the repository root first.
// Requires Playwright and Chromium; no application dependency changes needed.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true,args:['--no-sandbox']});
 const context = await browser.newContext({viewport:{width:390,height:844}, timezoneId:'Asia/Shanghai'});
 const page = await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',r=>r.abort()); // No production API calls in smoke tests.
 const base=process.env.SHICI_TEST_URL || 'http://127.0.0.1:8081';
 await page.goto(base); await page.waitForFunction(()=>document.querySelector('#w-word').textContent==='accommodation');
 async function read(store,key) {return page.evaluate(({store,key})=>new Promise((resolve,reject)=>{const r=indexedDB.open('shici',2);r.onsuccess=()=>{const q=r.result.transaction(store).objectStore(store);const v=key?q.get(key):q.getAll();v.onsuccess=()=>resolve(v.result);v.onerror=()=>reject(v.error);};}),{store,key});}
 async function put(store,value) {return page.evaluate(({store,value})=>new Promise(resolve=>{const r=indexedDB.open('shici',2);r.onsuccess=()=>{const t=r.result.transaction(store,'readwrite');t.objectStore(store).put(value);t.oncomplete=resolve;};}),{store,value});}
 let words=await read('words'); assert.equal(words.filter(w=>w.track==='雅思G').length,24); assert(words.some(w=>w.w==='fulfillment'));
 assert.equal(new Set(words.map(w=>w.w.toLowerCase())).size,words.length);
 for(const w of words.filter(w=>w.track==='雅思G')) {assert(w.coll.length>=2 && w.paraphrase && w.usage && w.p && w.prompt);assert(w.blank && w.blank.s.includes('____'));}
 // Upgrade must preserve existing learning history and user content.
 let old=words.find(w=>w.w==='fulfillment'); Object.assign(old,{status:'known',due:123456789,ef:2.1,reps:8,fav:true,d:'自定义释义'});await put('words',old);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#w-word').textContent==='accommodation');
 const restored=await read('words','fulfillment'); for(const k of ['status','due','ef','reps','fav','d']) assert.equal(restored[k],old[k]);
 // First learning, task counters and details.
 await page.locator('#btn-ok').click(); await page.waitForTimeout(200);
 assert.equal((await read('words','accommodation')).status,'review');
 await page.locator('[data-tab="library"]').click();await page.getByRole('button',{name:'雅思G',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.wrow').length===24);
 assert.equal(await page.locator('.wrow').count(),24);
 await page.locator('.wrow').filter({hasText:'accommodation'}).click();await page.locator('#word-detail').waitFor({state:'visible'});
 assert.match(await page.locator('#detail-content').innerText(),/分能力练习记录/); await page.locator('#close-detail').click();
 // Kind-specific failures must precede previously unpractised terms.
 await put('drills',{w:'privacy',kind:'paraphrase',dim:'认词',ok:false,score:0,ts:Date.now()});
 await page.locator('[data-tab="practice"]').click();await page.locator('.drill-row').filter({hasText:'同义改写'}).click();
 await page.waitForSelector('.d-opt'); assert(await page.locator('.d-opt').count()>1);
 // Repeated submission must write one result only.
 const before=(await read('drills')).length;
 await page.locator('.d-opt').first().evaluate(b=>{b.click();b.click();});await page.waitForTimeout(200);
 assert.equal((await read('drills')).length,before+1);
 // Finish the set and check a failed word is included even though it is still new.
 const firstQuestion=await page.locator('.d-q').innerText();let questions=[firstQuestion];
 for(let i=0;i<9;i++){await page.locator('#drill-next').click();await page.waitForSelector('.d-opt');questions.push(await page.locator('.d-q').innerText());await page.locator('.d-opt').first().click();}
 assert(questions.includes('control over personal information'));
 await page.locator('#drill-exit').click();
 // Review queue must remain in review mode after async rendering settles.
 let accommodation=await read('words','accommodation');accommodation.due=1;await put('words',accommodation);
 await page.locator('#btn-start-review').click();await page.waitForTimeout(250);assert.equal(await page.locator('#card-mode').innerText(),'复习');assert.equal(await page.locator('#w-word').innerText(),'accommodation');
 await page.locator('[data-tab="today"]').click();await page.locator('#screen-today summary').click();await page.locator('#output-draft').fill('Reliable public transport can reduce my commute.');await page.locator('#save-output').click();await page.waitForTimeout(150);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#output-draft').value.includes('Reliable'));assert.match(await page.locator('#output-draft').inputValue(),/Reliable/);
 await page.locator('#study-track').selectOption('商务');await page.waitForFunction(()=>document.querySelector('#w-word').textContent!=='maintenance');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#study-track').value==='商务');
 // Service worker must have cached the newly added word list.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForTimeout(500);
 const cached=await page.evaluate(async()=>{const c=await caches.open('shici-2.3');return !!await c.match('./ielts-seed.js');});assert(cached);
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#w-word').textContent!=='—');
 assert.equal(errors.length,0,errors.join('\n'));
 await context.setOffline(false);await page.locator('#study-track').selectOption('雅思G');await page.waitForTimeout(200);
 await page.screenshot({path:'/tmp/shici-ielts-mobile.png',fullPage:true});
 console.log('PASS: seed content, preserved progress, track filters, details, answer logging, failure priority, review queue, saved writing, offline reload; no browser errors.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
