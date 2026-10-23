import test from 'node:test';
import assert from 'node:assert/strict';
import {createZoomController,zoomLimits,rubberBand} from '../lib/userscript-zoom.mjs';

test('zoom limits keep the photo edges inside the frame and centre a photo smaller than it',()=>{
 const box={left:0,top:0,width:300,height:400};
 assert.deepEqual(zoomLimits({box,base:{x:150,y:200},content:{width:300,height:200},scale:1}),{x:{min:0,max:0},y:{min:0,max:0}});
 assert.deepEqual(zoomLimits({box,base:{x:150,y:200},content:{width:300,height:200},scale:3}),{x:{min:-300,max:300},y:{min:-100,max:100}});
 assert.equal(rubberBand(10,0,5),5+5*.35);assert.equal(rubberBand(-10,0,5),-10*.35);assert.equal(rubberBand(3,0,5),3);
});

function fixture(){
 const listeners={},windowListeners={},changes=[];
 const image={style:{},naturalWidth:300,naturalHeight:400};
 let scale=1,tx=0,ty=0;
 image.getBoundingClientRect=()=>{const m=/translate3d\(([-\d.e]+)px, ?([-\d.e]+)px, ?0\) scale\(([\d.e]+)\)/.exec(image.style.transform||'');[tx,ty,scale]=m?[+m[1],+m[2],+m[3]]:[0,0,1];return {left:150+tx-150*scale,top:200+ty-200*scale,width:300*scale,height:400*scale};};
 const media={getBoundingClientRect:()=>({left:0,top:0,width:300,height:400}),addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),setPointerCapture(){}};
 const window={addEventListener:(type,fn)=>(windowListeners[type]??=[]).push(fn),performance:{now:()=>0}};
 let gestures=0;
 const zoom=createZoomController({window,media,target:()=>image,onChange:value=>changes.push(value),onGesture:()=>gestures++});
 const fire=(type,id,x,y,extra={})=>{const event={type,pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0,target:{closest:()=>null},preventDefault(){},...extra};for(const fn of (type==='pointerdown'?listeners:windowListeners)[type]||[])fn(event);return event;};
 return {zoom,image,fire,changes,listeners,gestures:()=>gestures,state:()=>({scale,tx,ty})};
}

test('a two-finger pinch zooms around the fingers, cancels the swipe, and pans with the fingers',()=>{
 const f=fixture();
 f.fire('pointerdown',1,100,200);f.fire('pointerdown',2,200,200);
 assert.equal(f.gestures(),1);assert.equal(f.zoom.gesturing,true);
 f.fire('pointermove',1,50,200);f.fire('pointermove',2,250,200);
 f.image.getBoundingClientRect();
 assert.equal(f.state().scale,2);assert.equal(f.state().tx,0);
 f.fire('pointermove',1,80,200);f.fire('pointermove',2,280,200);
 f.image.getBoundingClientRect();
 assert.equal(f.state().tx,30);
 f.fire('pointerup',1,80,200);f.fire('pointerup',2,280,200);
 assert.equal(f.zoom.scale,2);assert.equal(f.zoom.gesturing,false);
 assert.equal(f.changes.at(-1),2);
});

test('pinching below fit snaps back to 1 and clears the transform; one finger on a fitted photo does nothing',()=>{
 const f=fixture();
 f.fire('pointerdown',1,140,200);f.fire('pointermove',1,100,200);
 assert.equal(f.image.style.transform||'','');
 f.fire('pointerdown',2,200,200);
 f.fire('pointermove',1,150,200);f.fire('pointermove',2,170,200);
 assert.ok(f.zoom.scale<1);
 f.fire('pointerup',1,150,200);f.fire('pointerup',2,170,200);
 assert.equal(f.zoom.scale,1);assert.equal(f.image.style.transform,'');assert.equal(f.changes.at(-1),1);
});

test('one finger pans a zoomed photo within its edges, suppresses the tap, and reset restores the fit',()=>{
 const f=fixture();
 f.zoom.zoomTo(2);
 assert.equal(f.zoom.scale,2);
 f.fire('pointerdown',1,150,200);f.fire('pointermove',1,250,260);
 f.image.getBoundingClientRect();
 assert.deepEqual([f.state().tx,f.state().ty],[100,60]);
 f.fire('pointermove',1,450,200);f.image.getBoundingClientRect();
 assert.ok(f.state().tx>150&&f.state().tx<300,'past the edge it resists');
 f.fire('pointerup',1,450,200,{type:'pointercancel'});
 f.image.getBoundingClientRect();
 assert.equal(f.state().tx,150);
 const click={preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};f.listeners.click[0](click);
 assert.equal(click.prevented,true);
 f.zoom.reset();
 assert.equal(f.zoom.scale,1);assert.equal(f.image.style.transform,'');
});

test('zoomTo clamps to five times and panBy moves only while zoomed',()=>{
 const f=fixture();
 f.zoom.panBy(50,0);assert.equal(f.image.style.transform||'','');
 f.zoom.zoomTo(9);assert.equal(f.zoom.scale,5);
 f.zoom.panBy(100,0);f.image.getBoundingClientRect();assert.equal(f.state().tx,-100);
});
