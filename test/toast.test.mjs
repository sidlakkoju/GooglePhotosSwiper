import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {albumCandidates} from '../public/model.js';
import {loadReviewBatch,importMessage} from '../public/import-review.js';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

function createToastHarness(){
 const classes=new Set();
 const elements={
  toast:{textContent:'',classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},
  'send-album':{},
  'album-confirmation':{},
  'album-dialog':{open:false,showModal(){this.open=true;},close(){this.open=false;}},
  'cancel-album':{},
  'confirm-album':{}
 };
 const timers=new Map();
 let timerId=0;
 const context={
  $:id=>elements[id],
  albumCandidates,
  workspace:{albumTitle:'Photos Swipe review',accountLabel:'Synthetic account'},
  items:[{id:'queued',type:'photo'}],
  decisions:{queued:'remove'},
  setTimeout(callback,delay){assert.equal(delay,2800);timers.set(++timerId,callback);return timerId;},
  clearTimeout:id=>timers.delete(id)
 };
 const lines=source.split('\n');
 runInNewContext(lines.filter(line=>line.startsWith('let toastTimer')||line.startsWith('function dismissToast(')||line.startsWith('function toast(')||line.startsWith("$('toast').onclick=")||line.startsWith("$('send-album').onclick=")).join('\n'),context);
 return {elements,classes,timers,notify:message=>context.toast(message)};
}

test('opening the send dialog clears the Undo toast and timer without reviving it on cancel',()=>{
 const {elements,classes,timers,notify}=createToastHarness();
 notify('Last swipe undone');
 assert.equal(classes.has('show'),true);
 assert.equal(timers.size,1);
 elements['send-album'].onclick();
 assert.equal(elements['album-dialog'].open,true);
 assert.equal(elements['album-confirmation'].textContent,'Add 1 removal candidate to “Photos Swipe review” in Google Photos → Albums (Synthetic account)?');
 assert.equal(classes.has('show'),false);
 assert.equal(elements.toast.textContent,'');
 assert.equal(timers.size,0);
 elements['cancel-album'].onclick();
 assert.equal(elements['album-dialog'].open,false);
 assert.equal(classes.has('show'),false);
 notify('Album ready. Sent items cleared from the queue.');
 assert.equal(classes.has('show'),true);
 assert.equal(timers.size,1);
 [...timers.values()][0]();
 assert.equal(classes.has('show'),false);
 assert.equal(elements.toast.textContent,'');
 assert.equal(timers.size,0);
});

test('toast replacement and click dismissal cancel the previous timer',()=>{
 const {elements,classes,timers,notify}=createToastHarness();
 notify('First notification');
 const firstTimer=[...timers.keys()][0];
 notify('Second notification');
 assert.equal(timers.has(firstTimer),false);
 assert.equal(timers.size,1);
 assert.equal(elements.toast.textContent,'Second notification');
 elements.toast.onclick();
 assert.equal(classes.has('show'),false);
 assert.equal(elements.toast.textContent,'');
 assert.equal(timers.size,0);
});

test('loading no new fake media shows a notification in its own flow space before the empty-state queue button',async()=>{
 const items=[{id:'synthetic-photo',type:'photo',decision:'remove'}];
 const result=await loadReviewBatch({initial:{items,cursor:'older'},fetchPage:async()=>({count:0}),readWorkspace:async()=>({items,cursor:null,exhausted:true})});
 assert.equal(result.added,0);
 const {elements,classes,notify}=createToastHarness();
 notify(importMessage(result));
 assert.match(elements.toast.textContent,/0 new items to review/);
 assert.equal(classes.has('show'),true);
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 const main=html.match(/<main>([\s\S]*?)<\/main>/)[1];
 assert.match(main,/<div id="toast" role="status" aria-live="polite"><\/div><section id="review-view">/);
 assert.ok(main.indexOf('id="toast"')<main.indexOf('id="empty-queue"'));
 assert.equal((html.match(/id="toast"/g)||[]).length,1);
 const rules=[...css.matchAll(/#toast(?:\.show)?\s*\{([^}]*)\}/g)].map(match=>match[1]).join(';');
 assert.match(rules,/position:static(?:;|$)/);
 assert.match(rules,/display:none(?:;|$)/);
 assert.match(rules,/display:block(?:;|$)/);
 assert.match(rules,/overflow-wrap:anywhere(?:;|$)/);
 assert.doesNotMatch(rules,/(?:position\s*:\s*(?:fixed|absolute|sticky)|(?:top|bottom|left|right|transform)\s*:)/);
});
