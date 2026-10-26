// Run a static server on 8081 first. Requires Playwright and Chromium.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
 const base=process.env.SHICI_TEST_URL||'http://127.0.0.1:8081';
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',permissions:['microphone']});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
 async function read(store,key){return page.evaluate(({store,key})=>new Promise((resolve,reject)=>{const r=indexedDB.open('shici-training',1);r.onsuccess=()=>{const o=r.result.transaction(store).objectStore(store),q=key?o.get(key):o.getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);};}),{store,key});}
 const open=async()=>{await page.locator('#screen-today .training-open').click();await page.waitForFunction(()=>!document.querySelector('#training-task').disabled);};
 const select=async id=>{await page.locator('#training-task').selectOption(id);await page.waitForFunction(()=>!document.querySelector('#training-task').disabled);};
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#w-word').textContent!=='—');await open();
 assert.equal(await page.locator('#training-task option').count(),9);
 await page.locator('#complete-training').click();await page.waitForFunction(()=>document.querySelector('#training-status').textContent.includes('请先'));assert.equal((await read('attempts')).length,0);
 const letter='I am writing to report a problem with the heating in my flat. Could you arrange a repair?';
 await page.locator('#training-text').fill(letter);await page.locator('#training-checks input').first().check();await page.locator('#save-training').click();await page.waitForFunction(()=>document.querySelector('#training-status').textContent.includes('文字草稿'));
 await select('letter-friend');assert.equal(await page.locator('#training-text').inputValue(),'');await select('letter-repair');assert.equal(await page.locator('#training-text').inputValue(),letter);assert(await page.locator('#training-checks input').first().isChecked());
 await page.locator('#complete-training').click();await page.waitForFunction(()=>document.querySelector('#training-history details')!==null);assert.equal((await read('attempts')).length,1);
 // Saved attempts are snapshots, independent of later draft edits.
 await page.locator('#training-text').fill('This is a later revision.');await page.locator('#training-back').click();await page.waitForTimeout(150);await page.reload();await page.waitForFunction(()=>document.querySelector('#w-word').textContent!=='—');await open();assert.equal(await page.locator('#training-text').inputValue(),'This is a later revision.');assert.equal((await read('attempts'))[0].text,letter);
 await select('essay-training');assert.match(await page.locator('#writing-count').innerText(),/完整 Task 2 至少 250/);await page.locator('#training-text').fill('Practical experience helps people develop reliable skills for work.');await page.locator('#complete-training').click();await page.waitForFunction(()=>document.querySelector('#training-total').textContent.includes('段落 1 次'));
 // Real MediaRecorder with Chromium's fake microphone; validate durable Blob playback.
 await select('speaking-place');await page.locator('#start-recording').click();await page.waitForFunction(()=>!document.querySelector('#stop-recording').disabled);assert(await page.locator('#training-task').isDisabled());
 await page.waitForTimeout(1300);await page.locator('#stop-recording').click();await page.waitForFunction(()=>document.querySelector('#training-status').textContent.includes('录音已保存'));
 const audio=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('shici-training',1);r.onsuccess=()=>{const q=r.result.transaction('drafts').objectStore('drafts').get('speaking-place');q.onsuccess=()=>resolve({bytes:q.result.audio.size,type:q.result.audio.type});};}));assert(audio.bytes>0);assert.match(audio.type,/audio/);
 await page.locator('#training-audio').evaluate(a=>a.play());await page.waitForFunction(()=>document.querySelector('#training-audio').currentTime>0);await page.locator('#training-audio').evaluate(a=>a.pause());
 await page.locator('#complete-training').click();await page.waitForFunction(()=>document.querySelector('#training-total').textContent.includes('口语 1 次'));
 await page.reload();await page.waitForFunction(()=>document.querySelector('#w-word').textContent!=='—');await open();await select('speaking-place');assert.equal(await page.locator('#training-audio').getAttribute('src')!==null,true);assert.equal(await page.locator('#training-history audio').count(),1);
 // Recording is stopped and saved when navigating away.
 await page.locator('#start-recording').click();await page.waitForFunction(()=>!document.querySelector('#stop-recording').disabled);await page.waitForTimeout(700);await page.locator('[data-tab="library"]').click();await page.waitForFunction(()=>document.querySelector('#stop-recording').disabled);await page.locator('[data-tab="today"]').click();await open();await select('speaking-place');assert(await page.locator('#training-audio').isVisible());
 // Four independent scores retain source/date. Invalid half-band steps cannot submit.
 await page.locator('#band-form').locator('..').locator('summary').click();
 for(const [skill,band] of [['听力','7.5'],['阅读','7'],['写作','6.5'],['口语','6']]){await page.locator('#score-skill').selectOption(skill);await page.locator('#score-band').fill(band);await page.locator('#score-note').fill('Mock test <script>unsafe</script>');await page.locator('#save-score').click();await page.waitForFunction(()=>!document.querySelector('#save-score').disabled);}
 assert.equal((await read('scores')).length,4);assert.equal(await page.locator('.band-card').count(),4);assert.match(await page.locator('.band-card').nth(2).innerText(),/6.5/);assert.equal(await page.locator('#score-history script').count(),0);
 await page.locator('#score-band').fill('6.3');await page.locator('#save-score').click();assert.equal((await read('scores')).length,4);
 await page.locator('#score-history button').first().click();await page.waitForFunction(()=>document.querySelectorAll('#score-history .score-row').length===3);
 await page.locator('#screen-training').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/tmp/shici-v2-training.png',fullPage:true});
 // Offline training and score history survive reload.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForTimeout(500);assert(await page.evaluate(async()=>!!await(await caches.open('shici-2.3')).match('./ielts-training.js')));
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#w-word').textContent!=='—');await open();await select('essay-training');assert.match(await page.locator('#training-text').inputValue(),/Practical/);assert.equal(await page.locator('#score-history .score-row').count(),3);
 assert.equal(errors.length,0,errors.join('\n'));
 // Permission rejection must preserve text workflow.
 const denied=await browser.newContext();const p=await denied.newPage();await p.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});await p.goto(base);await p.waitForFunction(()=>document.querySelector('#w-word').textContent!=='—');await p.locator('#screen-today .training-open').click();await p.waitForFunction(()=>!document.querySelector('#training-task').disabled);await p.locator('#training-task').selectOption('speaking-work');await p.waitForFunction(()=>!document.querySelector('#training-task').disabled);await p.locator('#start-recording').click();await p.waitForFunction(()=>document.querySelector('#training-status').textContent.includes('权限未允许'));assert(await p.locator('#start-recording').isEnabled());assert(await p.locator('#training-task').isEnabled());await p.locator('#training-text').fill('I would like to improve my communication skills.');await p.locator('#save-training').click();await p.waitForFunction(()=>document.querySelector('#training-status').textContent.includes('文字草稿'));
 console.log('PASS: 9 task prompts; drafts, checks and history snapshots; recording, playback and reload; recording cleanup on navigation; denied microphone fallback; independent score validation/deletion; offline persistence; no browser errors.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
