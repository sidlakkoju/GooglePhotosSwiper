import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleSwipe,releaseSwipe,animateSwipe} from '../public/swipe.js';
const event=(clientX,timeStamp)=>({clientX,timeStamp});
function release(points,width=300,cancel=false){
 const samples=[];
 for(const [x,time] of points.slice(0,-1))sampleSwipe(samples,event(x,time));
 const [x,time]=points.at(-1);
 return releaseSwipe(samples,event(x,time),points[0][0],width,cancel);
}
test('release uses one third of the actual card width and a strict distance threshold',()=>{
 assert.equal(release([[0,0],[100,1000]]).commit,false);
 assert.equal(release([[0,0],[101,1000]]).commit,true);
 assert.equal(release([[0,0],[-101,1000]]).commit,true);
 assert.equal(release([[0,0],[101,1000]],600).commit,false);
});
test('short flings commit in either direction only above .5 px/ms',()=>{
 assert.equal(release([[0,0],[30,50]]).commit,true);
 assert.equal(release([[0,0],[-30,50]]).commit,true);
 assert.equal(release([[0,0],[25,50]]).commit,false);
});
test('recent reversal, stationary release and expired fast movement do not commit',()=>{
 assert.equal(release([[0,0],[60,100],[30,150]]).commit,false);
 assert.equal(release([[0,0],[30,20],[30,200]]).commit,false);
 assert.equal(release([[0,0],[50,50],[50,1000],[55,1050]]).commit,false);
});
test('pointer cancellation never commits by distance or velocity',()=>{
 assert.equal(release([[0,0],[400,20]],300,true).commit,false);
});
test('throw duration scales with speed and stays within 180–300ms',()=>{
 assert.equal(release([[0,0],[101,1000]]).duration,300);
 assert.equal(release([[0,0],[50,50]]).duration,240);
 assert.equal(release([[0,0],[90,10]]).duration,180);
});
test('fly-off clears the viewport in either direction and snap-back overshoots for 320ms',()=>{
 let frames,options;
 const element={style:{transform:'translateX(40px)'},getBoundingClientRect:()=>({width:300}),animate:(f,o)=>{frames=f;options=o;}};
 animateSwipe(element,40,true,240);
 assert.equal(frames[0].transform,'translateX(40px)');
 assert.match(frames[1].transform,/translateX\(1300px\)/);
 assert.equal(options.duration,240);
 animateSwipe(element,-40,true,180);
 assert.match(frames[1].transform,/translateX\(-1300px\)/);
 animateSwipe(element,40,false);
 assert.equal(frames[1].transform,'translateX(0px)');
 assert.equal(options.duration,320);
 assert.equal(options.easing,'cubic-bezier(.2,1.5,.5,1)');
});

test('outgoing visual copies are removed after animation while the original stays available',async()=>{
 const {throwSwipe}=await import('../public/swipe.js');
 let finish,removed=false,appended=null;
 const child={removeAttribute(){}};
 const copy={style:{},removeAttribute(){},querySelectorAll:()=>[child],setAttribute(){},remove(){removed=true;},getBoundingClientRect:()=>({width:300}),animate:()=>({finished:new Promise(resolve=>{finish=resolve;})})};
 const original={style:{},ownerDocument:{body:{}},parentNode:{append:element=>{appended=element;}},cloneNode:()=>copy,getBoundingClientRect:()=>({left:10,top:20,width:300,height:400})};
 assert.equal(throwSwipe(original,1,240),undefined);
 assert.equal(appended,copy);
 assert.equal(removed,false);
 assert.equal(copy.inert,true);
 assert.equal(copy.style.pointerEvents,'none');
 finish();
 await Promise.resolve();
 assert.equal(removed,true);
});
