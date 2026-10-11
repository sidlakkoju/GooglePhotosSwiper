import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {describeConnection} from '../public/connection.js';
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const element=()=>({children:[],hidden:false,append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},setAttribute(){}});
function queueContext(){
 const elements=Object.fromEntries(['queue-list','export','operations','album-link','send-album','album-confirmation','album-dialog','cancel-album','confirm-album'].map(id=>[id,element()]));
 const notices=[],item={id:'photo',name:'Synthetic photo.jpg',type:'photo',url:'/fake.jpg'},context={$:id=>elements[id],document:{createElement:element},IntersectionObserver:class{disconnect(){} observe(){}},queueObserver:null,queueGeneration:0,thumbnailTasks:[],items:[item],decisions:{photo:'remove'},history:[{id:'photo'}],workspace:{albumKey:'fake album',albumTitle:'Photos Swipe · Review · synthetic-account',accountLabel:'Synthetic account',jobs:[]},mode:'google',busy:false,animating:false,bridgeConnected:true,date:()=>'',formatBytes:()=>'',googleLink:()=>'',render(){},dismissToast(){},toast:message=>notices.push(message),updateDecision:async(i,d)=>context.decisions[i.id]=d,albumCandidates:()=>[item],removalQueue:()=>context.decisions.photo==='remove'?[item]:[],loadQueueThumbnail(){}};
 vm.createContext(context);
 vm.runInContext(app.slice(app.indexOf('function renderQueue('),app.indexOf('function renderReconciliation(')),context);
 return {context,elements,notices,item};
}
test('Keep instead confirms success and preserves the existing album link for a nonempty queue',async()=>{
 const {context,elements,notices,item}=queueContext();context.renderQueue([item]);context.renderOperations();
 assert.equal(elements['album-link'].hidden,false);assert.equal(elements['album-link'].href,'https://photos.google.com/album/fake%20album');
 await elements['queue-list'].children[0].children.at(-1).onclick();
 assert.equal(context.decisions.photo,'keep');assert.equal(context.history.length,0);assert.deepEqual(notices,['Synthetic photo.jpg kept · Removed from the removal queue']);
 context.renderQueue([]);context.renderOperations();assert.equal(elements['album-link'].hidden,false);
});
test('Keep instead errors show failure without a success confirmation',async()=>{
 const {context,elements,notices,item}=queueContext();context.updateDecision=async()=>{throw Error('Wait for the album update');};context.renderQueue([item]);
 await elements['queue-list'].children[0].children.at(-1).onclick();assert.equal(context.decisions.photo,'remove');assert.deepEqual(notices,['Wait for the album update']);
});
test('send confirmation names the exact album, location and account, and Cancel only closes',()=>{
 const {context,elements}=queueContext();let opened=0,closed=0;elements['album-dialog'].showModal=()=>opened++;elements['album-dialog'].close=()=>closed++;
 vm.runInContext(app.slice(app.indexOf("$('send-album').onclick="),app.indexOf("$('import-next').onclick=")),context);
 elements['send-album'].onclick();assert.equal(opened,1);assert.equal(elements['album-confirmation'].textContent,'Add 1 removal candidate to “Photos Swipe · Review · synthetic-account” in Google Photos → Albums (Synthetic account)?');
 elements['cancel-album'].onclick();assert.equal(closed,1);assert.equal(context.decisions.photo,'remove');assert.match(html,/id="cancel-album"[^>]*>Cancel<\/button>/);
});
test('guide is visible on first run, dismisses persistently and can be reopened',()=>{
 const elements={'review-guide':element(),'dismiss-guide':element()},saved=new Map();const context={$:id=>elements[id],localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)}};
 const setup=app.slice(app.indexOf("try{$('review-guide').open="),app.indexOf("$('toast').onclick="));vm.runInNewContext(setup,context);assert.equal(elements['review-guide'].open,true);elements['review-guide'].open=false;elements['review-guide'].ontoggle();assert.equal(saved.get('photos-swipe-guide-dismissed'),'true');vm.runInNewContext(setup,context);assert.equal(elements['review-guide'].open,false);elements['review-guide'].open=true;elements['review-guide'].ontoggle();assert.equal(elements['review-guide'].open,true);elements['dismiss-guide'].onclick();assert.equal(elements['review-guide'].open,false);vm.runInNewContext(setup,context);assert.equal(elements['review-guide'].open,false);
 context.localStorage={getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}};vm.runInNewContext(setup,context);elements['review-guide'].open=true;elements['dismiss-guide'].onclick();assert.equal(elements['review-guide'].open,false);
 assert.match(html,/<details id="review-guide"[^>]*open>/);assert.match(html,/Swipes and album updates never delete photos/);assert.match(html,/<summary>Quick guide<\/summary>/);
 const queueStart=html.indexOf('<section id="queue-view"');assert.ok(html.indexOf('id="album-link"')<queueStart);
 assert.match(html,/<svg[^>]*>.*?<\/svg><\/span><section><small>In Trash/);
});
test('connected status explains the Chrome connection and required Photos tab',()=>{
 const status=describeConnection({installed:true,paired:true,label:'Synthetic account'});assert.match(status.summary,/Google Photos connected via Chrome extension/);assert.match(status.summary,/Keep the Photos tab open/);
});

test('guide first step follows loading, review and library exhaustion',()=>{
 const step=element(),context={$:()=>step,items:[],decisions:{},workspace:{},pending:(items,decisions)=>items.filter(item=>!decisions[item.id])};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function renderGuide('),app.indexOf("$('toast').onclick=")),context);
 context.renderGuide();assert.match(step.innerHTML,/Load a batch/);
 context.items=[{id:'synthetic-photo'}];context.renderGuide();assert.match(step.innerHTML,/Your items are ready/);assert.doesNotMatch(step.innerHTML,/Load 50 more/);
 context.decisions={'synthetic-photo':'keep'};context.renderGuide();assert.match(step.innerHTML,/All loaded items are reviewed/);assert.match(step.innerHTML,/Load 50 more/);
 context.workspace.exhausted=true;context.renderGuide();assert.match(step.innerHTML,/Refresh latest/);assert.doesNotMatch(step.innerHTML,/Load 50 more/);
 context.decisions={};context.renderGuide();assert.match(step.innerHTML,/Your items are ready/);
 assert.match(app,/function render\(\)\{renderGuide\(\);/);assert.match(html,/id="guide-first-step"/);
});
