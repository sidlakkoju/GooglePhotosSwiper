import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {albumCandidates} from '../public/model.js';

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
 assert.equal(elements['album-confirmation'].textContent,'Add 1 removal candidate to your Photos Swipe review album?');
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
