import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createSwipeFeedback} from '../lib/userscript-swipe.mjs';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');

function fixture(){
 const handlers={},buttons=[],classes=new Set();
 const video={tagName:'VIDEO',paused:true,muted:true,controls:false,plays:0,pauses:0,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},play(){this.plays++;this.paused=false;this.listeners.play?.();return Promise.resolve();},pause(){this.pauses++;this.paused=true;this.listeners.pause?.();}};
 const image={style:{}};
 const mediaElement={style:{touchAction:'pan-y'},childNodes:buttons,setAttribute(key,value){this[key]=value;},querySelector:tag=>tag==='video'?video:image,append:button=>buttons.push(button),addEventListener:(type,fn)=>handlers[type]=fn};
 const card={style:{},classList:{contains:name=>classes.has(name),remove:name=>classes.delete(name),toggle(name,on){const value=on??!classes.has(name);if(value)classes.add(name);else classes.delete(name);return value;}}};
 const nodes={card,media:mediaElement,zoom:{value:'1'},enlarge:{}};
 const context=vm.createContext({mediaElement,document:{createElement:()=>({dataset:{},style:{},addEventListener(){},closest(selector){return selector==='button'?this:null;}})},$:id=>nodes[id],swipeFeedback:{reset(){}},refreshPreviews(){},stopMedia(){},underCard:{querySelector:()=>null},generation:0,shown:null});
 vm.runInContext(source.slice(source.indexOf(' function updateVideoControls()'),source.indexOf(' queue_detailsElement.addEventListener')),context);
 createSwipeFeedback({window:{},targets:[mediaElement],card,under:{style:{}},keep:{style:{}},remove:{style:{}},canSwipe:()=>false,onDecide(){},playbackOnClick:true});
 const click=target=>{target.onclick?.();handlers.click({target});};
 return {context,video,image,mediaElement,nodes,classes,buttons,click};
}

test('Play and Mute button clicks bubble without toggling media playback again',()=>{
 const f=fixture();f.context.addVideoControls(f.video);
 const [play,mute]=f.buttons;
 assert.equal(play.textContent,'Play');
 assert.equal(mute.textContent,'Unmute');
 f.click(play);assert.equal(f.video.paused,false);assert.equal(f.video.plays,1);assert.equal(play.textContent,'Pause');
 f.click(mute);assert.equal(f.video.muted,false);assert.equal(mute.textContent,'Mute');assert.equal(f.video.paused,false);assert.equal(f.video.pauses,0);
 f.click(play);assert.equal(f.video.paused,true);assert.equal(f.video.pauses,1);assert.equal(play.textContent,'Play');
 f.click(mute);assert.equal(f.video.muted,true);assert.equal(f.video.paused,true);assert.equal(f.video.plays,1);
 f.click(f.video);assert.equal(f.video.paused,false);assert.equal(play.textContent,'Pause');
 f.click(f.video);assert.equal(f.video.paused,true);assert.equal(play.textContent,'Play');
 f.video.controls=true;f.click(f.video);assert.equal(f.video.plays,2);
});

test('display and zoom reset leave touch actions to expanded CSS, while zoom above one allows pan and pinch',async()=>{
 const f=fixture();
 vm.runInContext(source.slice(source.indexOf(' async function display(item,'),source.indexOf(' function updateVideoControls()')),f.context);
 f.mediaElement.style.color='';
 await f.context.display(null);
 assert.equal(f.mediaElement.style.touchAction,'');
 vm.runInContext(source.split('\n').find(line=>line.startsWith(" $('zoom').oninput=")),f.context);
 vm.runInContext(source.split('\n').find(line=>line.startsWith(' function toggleEnlarge()')),f.context);
 f.context.toggleEnlarge();
 assert.equal(f.classes.has('expanded'),true);
 f.nodes.zoom.value='2';f.nodes.zoom.oninput();
 assert.equal(f.mediaElement.style.touchAction,'pan-x pan-y pinch-zoom');
 assert.equal(f.image.style.touchAction,'pan-x pan-y pinch-zoom');
 f.nodes.zoom.value='1';f.nodes.zoom.oninput();
 assert.equal(f.mediaElement.style.touchAction,'');
 assert.equal(f.image.style.touchAction,'');
 await f.context.display(null);
 assert.equal(f.classes.has('expanded'),true);
 assert.equal(f.mediaElement.style.touchAction,'');
 assert.ok(source.includes('.card.expanded .media{touch-action:pan-x pan-y pinch-zoom'));
 f.context.toggleEnlarge();assert.equal(f.classes.has('expanded'),false);
 assert.equal(f.mediaElement.style.touchAction,'');
 assert.ok(source.includes('.media{touch-action:none;'));
});
