/* 拾词 · G 类说写训练。原创题目，本机存储，不调用评分服务。 */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var escape = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
var tasks = [
 {id:'letter-repair',type:'letter',title:'正式书信 · 请求维修',minutes:20,min:150,tone:'正式',prompt:'You rent a flat and the heating has stopped working. Write a letter to your landlord. Describe the problem, explain how it affects you, and say what you would like the landlord to do.',points:['描述暖气故障','说明对生活的影响','提出具体维修请求'],phrases:['I am writing to report a problem with…','I would appreciate it if you could…','Please let me know when…'],checks:['三个要点都有展开','请求具体且语气礼貌','称呼与结尾一致，保持正式语气','检查时态、冠词和单复数']},
 {id:'letter-course',type:'letter',title:'半正式书信 · 调整培训时间',minutes:20,min:150,tone:'半正式',prompt:'You attend an evening course, but your work schedule has changed. Write a letter to your course tutor, whom you know. Explain the change, describe the difficulty, and ask about an alternative arrangement.',points:['解释工作时间的变化','说明上课困难','询问替代安排'],phrases:['I have recently been asked to…','Unfortunately, this means that…','Would it be possible to…'],checks:['说明写信目的并回应三个要点','对熟悉的老师保持礼貌自然','明确提出可行的安排','检查段落衔接和句子结构']},
 {id:'letter-friend',type:'letter',title:'非正式书信 · 邀请朋友',minutes:20,min:150,tone:'非正式',prompt:'You have moved to a new city for work. Write a letter to a friend. Describe your new home, explain what you enjoy about the city, and invite your friend to visit.',points:['描述新住处','介绍喜欢这座城市的原因','邀请来访并给出安排'],phrases:['I thought I would write and tell you about…','The best thing about living here is…','Why don’t you come and stay…?'],checks:['回应全部三个要点','使用适合朋友的亲切语气','邀请含具体安排','检查时态、拼写和结尾']},
 {id:'essay-transport',type:'essay',title:'议论文段落 · 公共交通',minutes:12,min:70,tone:'议论文主体段',prompt:'Some people think governments should spend more on public transport than on building new roads. To what extent do you agree or disagree? Write ONE body paragraph supporting a clear position.',points:['明确段落观点','解释原因或作用机制','给出具体例子并联系观点'],phrases:['One reason to prioritise… is that…','This would enable…','For example,…'],checks:['段落与题目直接相关','解释了原因而非只列观点','例子能支持中心论点','没有使用不确定的数据或生硬套句']},
 {id:'essay-training',type:'essay',title:'议论文段落 · 工作技能',minutes:12,min:70,tone:'议论文主体段',prompt:'Some people believe practical skills are more important than academic qualifications for finding a job. Discuss both views and give your opinion. Write ONE body paragraph explaining one side of the argument.',points:['说明讨论哪一方观点','展开因果解释','举例支持，不把个例说成普遍规律'],phrases:['Practical experience can help applicants…','This is particularly relevant in…','However, this does not mean that…'],checks:['本段只围绕一个中心展开','回应了所选一方的观点','例子具体且论证合理','区分自己的判断与事实']},
 {id:'essay-environment',type:'essay',title:'议论文段落 · 减少废弃物',minutes:12,min:70,tone:'议论文主体段',prompt:'Many communities produce increasing amounts of household waste. What are the causes, and what measures could reduce this problem? Write ONE body paragraph explaining a practical solution.',points:['提出一种可行措施','解释如何减少垃圾','说明实施条件或限制'],phrases:['A practical way to address this is to…','By encouraging households to…','For this measure to work,…'],checks:['措施针对家庭垃圾','说明措施如何起作用','考虑可行性而非只喊口号','检查搭配、指代和句子边界']},
 {id:'speaking-work',type:'speaking',title:'口语 Part 1 · 工作与技能',minutes:1,tone:'建议每题 20–30 秒',prompt:'What do you enjoy about your work? What skill would you like to improve? Answer both questions with a reason or example.',points:['直接回答问题','补充原因或例子','自然表达，不背完整答案'],phrases:['What I enjoy most is…','I would like to get better at…'],checks:['回答切题并适当展开','没有长时间停顿或重复','搭配和时态使用准确','回听检查重音、清晰度和语速']},
 {id:'speaking-place',type:'speaking',title:'口语 Part 2 · 有用的公共设施',minutes:2,tone:'准备 1 分钟，再说 1–2 分钟',prompt:'Describe a public facility that you find useful. Say what it is, where it is, how you use it, and explain why it is useful to you.',points:['设施是什么、在哪里','如何使用','为什么对你有用'],phrases:['The place I have in mind is…','What makes it useful is…'],checks:['覆盖提示并持续展开','例子具体、有个人细节','连接自然，没有机械堆连接词','回听检查发音和自我纠正']},
 {id:'speaking-technology',type:'speaking',title:'口语 Part 3 · 科技与工作',minutes:2,tone:'尝试解释、比较和举例',prompt:'How has technology changed the way people work? Do you think remote working is suitable for everyone? Explain your ideas and consider different situations.',points:['给出清晰观点','解释并举例','考虑不同工作或人群'],phrases:['It depends on the type of work…','One significant change is…'],checks:['回答有解释而非只有结论','能比较不同情况','词汇准确且表达连贯','回听检查可理解度，不刻意模仿口音']}
];
var draftQueue=Promise.resolve(), historyURLs=[], taskReady=false, micGeneration=0;
var dbPromise, selected = tasks[0], recording = null, stream = null, pendingMic = false, active = false;
var chunks = [], recordTask = null, recordStart = 0, recordTimer, stopTimer, audioURL = null, loadId = 0, saving = false;
function day() { var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function db() {
 if (!dbPromise) dbPromise=new Promise(function(resolve,reject){var r=indexedDB.open('shici-training',1);r.onupgradeneeded=function(){r.result.createObjectStore('drafts',{keyPath:'id'});r.result.createObjectStore('attempts',{keyPath:'id',autoIncrement:true});r.result.createObjectStore('scores',{keyPath:'id',autoIncrement:true});};r.onsuccess=function(){resolve(r.result);};r.onerror=function(){reject(r.error);};});
 return dbPromise;
}
function storage(store,method,value) {return db().then(function(d){return new Promise(function(resolve,reject){var t=d.transaction(store,method==='getAll'||method==='get'?'readonly':'readwrite'),q=t.objectStore(store)[method](value),result;q.onsuccess=function(){result=q.result;};t.oncomplete=function(){resolve(result);};t.onerror=function(){reject(t.error);};t.onabort=function(){reject(t.error||new Error('transaction aborted'));};});});}
function status(text) { $('training-status').textContent=text; }
function fail(e) { status(e && (e.name==='QuotaExceededError'||e.name==='UnknownError')?'本机存储空间不足或不可用，请先下载录音、复制文字后再清理。':'未能保存或读取，请保留当前文字并重试。'); }
function count(text) { return (text.match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g)||[]).length; }
function setCount() { $('writing-count').textContent=count($('training-text').value)+' 个英文词 · '+(selected.type==='letter'?'书信至少 150 词；建议 20 分钟':selected.type==='essay'?'段落练习建议 70–110 词；完整 Task 2 至少 250 词，建议 40 分钟':'可用此处记提纲或回听后的问题'); }
function checked() { return Array.from(document.querySelectorAll('#training-checks input')).map(function(x){return x.checked;}); }
function showAudio(blob) {
 $('training-audio').pause();
 if(audioURL) URL.revokeObjectURL(audioURL);audioURL=null;
 $('training-audio').hidden=!blob;$('download-recording').hidden=!blob;$('clear-recording').hidden=!blob;
 if(blob){audioURL=URL.createObjectURL(blob);$('training-audio').src=audioURL;$('download-recording').href=audioURL;$('download-recording').download=selected.id+(blob.type.indexOf('mp4')>=0?'.m4a':'.webm');}
 else {$('training-audio').removeAttribute('src');}
}
function updateDraft(id, patch) {
 var operation=draftQueue.catch(function(){}).then(function(){return storage('drafts','get',id);}).then(function(old){return storage('drafts','put',Object.assign({},old||{},{id:id},patch,{updatedAt:Date.now()}));});
 draftQueue=operation;return operation;
}
function saveDraft() {
 if(!taskReady)return draftQueue;
 var id=selected.id,text=$('training-text').value,checks=checked();
 return updateDraft(id,{text:text,checks:checks});
}
function loadTask() {
 var task=selected, token=++loadId;taskReady=false;
 $('training-title').textContent=task.title;$('training-prompt').textContent=task.prompt;$('training-tone').textContent=task.tone+' · 原创练习，非官方真题';
 $('training-points').innerHTML=task.points.map(function(x){return '<li>'+escape(x)+'</li>';}).join('');
 $('training-phrases').innerHTML=task.phrases.map(function(x){return '<li>'+escape(x)+'</li>';}).join('');
 $('training-checks').innerHTML=task.checks.map(function(x,i){return '<label><input type="checkbox" data-check="'+i+'"> '+escape(x)+'</label>';}).join('');
 $('recording-tools').hidden=task.type!=='speaking';$('training-text').value='';setCount();showAudio(null);
 $('training-duration').textContent=task.minutes+' 分钟练习建议';
 $('training-task').disabled=true;$('complete-training').disabled=true;$('save-training').disabled=true;
 return draftQueue.catch(function(){}).then(function(){return storage('drafts','get',task.id);}).then(function(d){if(token!==loadId)return;taskReady=true;$('training-text').value=d&&d.text||'';if(d&&d.checks) document.querySelectorAll('#training-checks input').forEach(function(c,i){c.checked=!!d.checks[i];});showAudio(d&&d.audio||null);setCount();status(d?'已载入本机草稿。录音保存在本机，不上传。':'文字、勾选和录音保存在本机；离开训练页时会保存文字。');}).catch(fail).finally(function(){if(token===loadId){$('training-task').disabled=false;$('complete-training').disabled=!taskReady;$('save-training').disabled=!taskReady;}});
}
function stopRecording() { if(recording && recording.state!=='inactive') recording.stop(); if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;}clearInterval(recordTimer);clearTimeout(stopTimer); }
async function startRecording() {
 if(pendingMic||recording)return;
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){status('此浏览器不支持录音；可使用系统录音机练习，并在这里保存回听笔记。');return;}
 var requestGeneration=++micGeneration;
 pendingMic=true;$('start-recording').disabled=true;$('training-task').disabled=true;$('complete-training').disabled=true;status('请允许麦克风访问。');
 try {
  stream=await navigator.mediaDevices.getUserMedia({audio:true});
  if(!active || requestGeneration!==micGeneration || selected.type!=='speaking'){stream.getTracks().forEach(function(t){t.stop();});stream=null;return;}
  chunks=[];recordTask=selected.id;recordStart=Date.now();
  var preferred=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(function(t){return MediaRecorder.isTypeSupported(t);});
  recording=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);
  var recorder=recording, capturedTask=recordTask;
  recorder.ondataavailable=function(e){if(e.data.size)chunks.push(e.data);};
  recorder.onstop=function(){
   var audio=new Blob(chunks,{type:recorder.mimeType||'audio/webm'}),seconds=Math.round((Date.now()-recordStart)/1000);
   recording=null;clearInterval(recordTimer);clearTimeout(stopTimer);
   $('start-recording').disabled=false;$('stop-recording').disabled=true;$('training-task').disabled=false;$('complete-training').disabled=false;
   if(!audio.size){status('没有录到音频，请检查麦克风后重试。');return;}
   updateDraft(capturedTask,{audio:audio,seconds:seconds}).then(function(){if(selected.id===capturedTask){showAudio(audio);status('录音已保存在本机，可回听或下载。再次录音会替换当前录音。');}}).catch(fail);
  };
  recorder.onerror=function(){stopRecording();status('录音中断，请检查设备，已录部分会尝试保存。');};
  recorder.start();$('stop-recording').disabled=false;$('training-task').disabled=true;$('complete-training').disabled=true;
  status('录音中：0 秒（最长 3 分钟，停止后自动保存）');
  recordTimer=setInterval(function(){status('录音中：'+Math.floor((Date.now()-recordStart)/1000)+' 秒（最长 3 分钟）');},1000);
  stopTimer=setTimeout(stopRecording,180000);
 }catch(e){if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;}recording=null;status(e.name==='NotAllowedError'?'麦克风权限未允许。可在浏览器设置中开启，或先保存文字提纲。':'无法启动麦克风，请检查设备；可以继续文字练习。');}
 finally{pendingMic=false;if(!recording){$('start-recording').disabled=false;$('training-task').disabled=false;$('complete-training').disabled=false;}}
}
async function complete() {
 var task=selected;
 if(saving||recording||pendingMic||!taskReady)return;saving=true;$('complete-training').disabled=true;$('training-task').disabled=true;
 try{
  await saveDraft();var draft=await storage('drafts','get',task.id);
  if(!count(draft.text||'')&&!draft.audio){status('请先写下英文练习内容或录音，再保存练习记录。');return;}
  await storage('attempts','put',{taskId:task.id,title:task.title,type:task.type,text:draft.text||'',checks:draft.checks||[],audio:draft.audio||null,seconds:draft.seconds||0,ts:Date.now()});
  status('练习记录已保存。自查勾选不是评分，未勾选的项目可留待下次改进。');await renderHistory();
 }catch(e){fail(e);}finally{saving=false;$('complete-training').disabled=false;$('training-task').disabled=false;}
}
function renderHistory() {
 return storage('attempts','getAll').then(function(rows){
  rows.sort(function(a,b){return b.ts-a.ts;});historyURLs.forEach(function(u){URL.revokeObjectURL(u);});historyURLs=[];$('training-history').innerHTML='';
  $('training-total').textContent='本机累计：书信 '+rows.filter(function(x){return x.type==='letter';}).length+' 次 · 段落 '+rows.filter(function(x){return x.type==='essay';}).length+' 次 · 口语 '+rows.filter(function(x){return x.type==='speaking';}).length+' 次';
  if(!rows.length){$('training-history').textContent='还没有记录。完成一次练习并保存后，会显示在这里。';return;}
  rows.slice(0,20).forEach(function(r){var box=document.createElement('details');box.className='training-history-item';var dt=new Date(r.ts);box.innerHTML='<summary>'+escape(r.title)+' · '+escape(dt.toLocaleDateString())+'</summary><p class="study-note">'+count(r.text||'')+' 个英文词 · 自查 '+(r.checks||[]).filter(Boolean).length+'/'+(r.checks||[]).length+' 项'+(r.audio?' · 录音 '+r.seconds+' 秒':'')+'</p><p class="saved-answer"></p>';
   box.querySelector('.saved-answer').textContent=r.text||'（无文字）';
   if(r.audio){var audio=document.createElement('audio');audio.controls=true;audio.preload='none';var url=URL.createObjectURL(r.audio);historyURLs.push(url);audio.src=url;box.appendChild(audio);var a=document.createElement('a');a.href=url;a.download=r.taskId+'-'+r.id+(r.audio.type.indexOf('mp4')>=0?'.m4a':'.webm');a.textContent='下载这次录音';box.appendChild(a);}
   var remove=document.createElement('button');remove.className='d-tip';remove.textContent='删除这次练习记录';remove.addEventListener('click',function(){storage('attempts','delete',r.id).then(renderHistory).catch(fail);});box.appendChild(remove);
   $('training-history').appendChild(box);
  });
 });
}
var skills=['听力','阅读','写作','口语'];
function renderScores(){return storage('scores','getAll').then(function(rows){
 rows.sort(function(a,b){return b.date.localeCompare(a.date)||b.ts-a.ts;});
 $('band-cards').innerHTML=skills.map(function(s){var r=rows.find(function(x){return x.skill===s;});return '<div class="band-card"><b>'+s+'</b><strong>'+(r?Number(r.band).toFixed(1):'—')+'</strong><span>'+ (r?escape(r.date+' · '+r.source):'尚未记录')+'</span><span>'+(!r?'目标 ≥ 7':r.band>=7?'本次记录达到 7+':'距目标 '+(7-r.band).toFixed(1)+' 分')+'</span></div>';}).join('');
 $('score-history').innerHTML='';
 if(!rows.length)$('score-history').textContent='记录可靠的模考或考试成绩，观察各科变化。';
 rows.slice(0,20).forEach(function(r){var row=document.createElement('div');row.className='score-row';var p=document.createElement('span');p.textContent=r.date+' · '+r.skill+' '+Number(r.band).toFixed(1)+' · '+r.source+(r.note?' · '+r.note:'');row.appendChild(p);var b=document.createElement('button');b.type='button';b.className='d-tip';b.textContent='删除';b.setAttribute('aria-label','删除'+r.skill+r.date+'成绩');b.addEventListener('click',function(){storage('scores','delete',r.id).then(renderScores).catch(fail);});row.appendChild(b);$('score-history').appendChild(row);});
});}
function wire(){
 $('training-task').innerHTML=tasks.map(function(t){return '<option value="'+t.id+'">'+t.title+'</option>';}).join('');
 $('training-task').addEventListener('change',async function(){var id=this.value;this.disabled=true;try{await saveDraft();selected=tasks.find(function(t){return t.id===id;});await loadTask();}catch(e){this.value=selected.id;this.disabled=false;fail(e);}});
 $('training-text').addEventListener('input',setCount);
 $('save-training').addEventListener('click',function(){saveDraft().then(function(){status('文字草稿与自查已保存到本机。');}).catch(fail);});
 $('complete-training').addEventListener('click',complete);
 $('clear-recording').addEventListener('click',function(){if(recording||pendingMic)return;updateDraft(selected.id,{audio:null,seconds:0}).then(function(){showAudio(null);status('当前录音草稿已删除，已保存的历史记录保留。');}).catch(fail);});
 $('start-recording').addEventListener('click',startRecording);$('stop-recording').addEventListener('click',stopRecording);
 $('score-date').value=day();$('score-date').max=day();
 $('band-form').addEventListener('submit',async function(e){e.preventDefault();var form=this;if(!form.reportValidity())return;var band=Number($('score-band').value),date=$('score-date').value;if(!Number.isFinite(band)||band<0||band>9||band*2!==Math.round(band*2)||date>day()){ $('score-status').textContent='分数须为 0–9，间隔 0.5；日期不能晚于今天。';return;}
  var b=$('save-score');b.disabled=true;try{await storage('scores','put',{skill:$('score-skill').value,band:band,date:date,source:$('score-source').value,note:$('score-note').value.trim(),ts:Date.now()});$('score-status').textContent='已保存。这是手动记录，系统未核验或估算分数。';$('score-note').value='';await renderScores();}catch(err){$('score-status').textContent='保存失败，请重试。';}finally{b.disabled=false;}
 });
 document.addEventListener('visibilitychange',function(){if(document.hidden){micGeneration++;stopRecording();if(active)saveDraft().catch(fail);}});
 window.addEventListener('pagehide',stopRecording);
}
wire();
window.IELTS_TRAINING={
 enter:function(){active=true;loadTask();renderHistory().catch(fail);renderScores().catch(fail);},
 leave:function(){if(!active)return;active=false;micGeneration++;stopRecording();document.querySelectorAll('#screen-training audio').forEach(function(a){a.pause();});saveDraft().catch(fail);}
};
})();
