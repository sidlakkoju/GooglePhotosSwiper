import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {sampleSwipe,releaseSwipe} from '../public/swipe.js';

const source=await readFile(new URL('../public/viewer.js',import.meta.url),'utf8');
for(const reduced of [false,true])test(`viewer batches swipe writes and caches geometry with reduced motion ${reduced}`,()=>{
 let reads=0,writes=0,nextFrame=0;
 const frames=new Map(),decisions=[];
 const style=new Proxy({},{set(target,key,value){writes++;target[key]=value;return true;}});
 const stage={style,getAnimations:()=>[],getBoundingClientRect(){reads++;return {left:0,top:0,width:300,height:400};},setPointerCapture(){},classList:{remove(){}}};
 const stamp={hidden:true,dataset:{}},swipeZone={textContent:''};
 const context=vm.createContext({working:false,canReview:true,current:{id:'synthetic'},review:{canDecide:()=>true},ready:true,scale:1,pointers:new Map(),swipe:null,swipeFrame:null,stage,stamp,swipeZone,sampleSwipe,releaseSwipe,window:{matchMedia:()=>({matches:reduced})},requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),decide:(decision,result)=>decisions.push({decision,result,transform:style.transform})});
 vm.runInContext(source.split('\n').find(line=>line.includes('function clearSwipe()')),context);
 vm.runInContext(source.slice(source.indexOf('  function down(e)'),source.indexOf('  for(const target of [stage,swipeZone])')),context);
 const event=x=>({pointerId:1,clientX:x,clientY:0,timeStamp:x,button:0,target:{closest:()=>false},currentTarget:stage});
 context.down(event(0));assert.equal(reads,1);
 for(let x=20;x<=120;x+=20)context.move(event(x));
 assert.equal(writes,0);assert.equal(reads,1);assert.equal(frames.size,1);
 for(const [id,callback] of frames){frames.delete(id);callback();}
 assert.equal(style.transform,reduced?'':'translateX(120px)');assert.equal(style.willChange,reduced?'':'transform');
 context.move(event(130));context.release(event(140));
 assert.equal(frames.size,0);assert.equal(reads,1);assert.equal(style.willChange,'');
 assert.equal(decisions[0].transform,reduced?'':'translateX(140px)');assert.equal(decisions[0].decision,'keep');assert.equal(decisions[0].result.bounds.width,300);
});

const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
for(const surface of ['deck','viewer'])for(const painted of [false,true])for(const outcome of ['commit','return','cancel'])test(`${surface} ${outcome} starts at release position with ${painted?'a previous':'no'} painted frame`,()=>{
 const frames=new Map(),starts=[];
 let nextFrame=0;
 const element={style:{},getAnimations:()=>[],getBoundingClientRect:()=>({left:0,top:0,width:300,height:400}),setPointerCapture(){},classList:{add(){},remove(){}}};
 const stamp={style:{},dataset:{}},swipeZone={};
 const context=vm.createContext({sampleSwipe,releaseSwipe,requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),window:{matchMedia:()=>({matches:false})},busy:false,animating:false,working:false,reviewActionsPending:0,workspaceLoadsPending:0,active:()=>({id:'first'}),$:id=>id==='card'?element:stamp,canReview:true,current:{id:'first'},review:{canDecide:()=>true},ready:true,scale:1,pointers:new Map(),swipe:null,swipeFrame:null,stage:element,stamp,swipeZone,choose(){starts.push(element.style.transform);},decide(){starts.push(element.style.transform);},animateSwipe(){starts.push(element.style.transform);}});
 if(surface==='deck')vm.runInContext(appSource.split('\n').find(line=>line.startsWith('let startX=')),context);
 else{
  vm.runInContext(source.split('\n').find(line=>line.includes('function clearSwipe()')),context);
  vm.runInContext(source.slice(source.indexOf('  function down(e)'),source.indexOf('  for(const target of [stage,swipeZone])')),context);
 }
 const event=(x,timeStamp)=>({pointerId:1,clientX:x,clientY:0,timeStamp,button:0,target:{tagName:'IMG',closest:()=>false},currentTarget:element});
 const down=surface==='deck'?element.onpointerdown:context.down;
 const move=surface==='deck'?element.onpointermove:context.move;
 down(event(0,0));
 move(event(20,100));
 if(painted)for(const [id,callback] of frames){frames.delete(id);callback();}
 move(event(40,200));
 const dx=outcome==='commit'?140:50;
 if(surface==='deck')(outcome==='cancel'?element.onpointercancel:element.onpointerup)(event(dx,400));
 else context.release(event(dx,400),outcome==='cancel');
 assert.deepEqual(starts,[surface==='deck'?`translateX(${dx}px) rotate(${dx/20}deg)`:`translateX(${dx}px)`]);
 assert.equal(frames.size,0);
 assert.equal(element.style.willChange,'');
});
