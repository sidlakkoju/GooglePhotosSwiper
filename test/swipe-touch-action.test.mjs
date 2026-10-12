import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSwipeFeedback} from '../lib/userscript-swipe.mjs';
const css=async()=>{const src=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');return [...src.matchAll(/([^{}"']+)\{([^{}]*touch-action:[^{}]*)\}/g)].map(m=>({sel:m[1].trim(),body:m[2]}));};
test('no swipe target (card, media, swipe strip) allows pan-y; pinch/pan only on zoomed or expanded view',async()=>{
 const rules=await css();
 for(const sel of ['.card','.media','.swipe']){const r=rules.find(r=>r.sel===sel);assert.ok(r,sel);assert.match(r.body,/touch-action:none/,sel);}
 for(const r of rules.filter(r=>/pan-y/.test(r.body)))assert.match(r.sel,/\.(zoomed|expanded)/,`${r.sel} must not allow pan-y`);
});
test('touchmove is prevented non-passively only after the drag locks horizontal; cancel springs back without deciding',()=>{
 const handlers={},opts={},decisions=[],anims=[];
 const card={style:{},getBoundingClientRect:()=>({width:300}),animate:(frames,o)=>{anims.push(o.duration);return {cancel(){},finished:Promise.resolve()};}};
 const target={addEventListener:(n,h,o)=>{handlers[n]=h;opts[n]=o;},setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
 const window={addEventListener(){},matchMedia:()=>({matches:false})};
 createSwipeFeedback({window,targets:[target],card,under:{style:{}},keep:{style:{}},remove:{style:{}},canSwipe:()=>true,onDecide:v=>decisions.push(v)});
 assert.equal(opts.touchmove?.passive,false);
 const p=(t,x)=>handlers[t]({pointerId:1,clientX:x,clientY:0,button:0,isPrimary:true,target:{tagName:'IMG'},preventDefault(){}});
 const touch=()=>{const e={cancelable:true,prevented:false,preventDefault(){this.prevented=true;}};handlers.touchmove(e);return e.prevented;};
 p('pointerdown',0);assert.equal(touch(),false);
 p('pointermove',-60);assert.equal(touch(),true);
 p('pointercancel',-60);
 assert.deepEqual(decisions,[]);assert.deepEqual(anims,[180]);assert.equal(touch(),false);
});
