import test from 'node:test';
import assert from 'node:assert/strict';
import {playVideo,setVideoMuted} from '../lib/userscript-video.mjs';

function video({blocked=false,pausesOnUnmute=false,paused=true,muted=true}={}){
 const element={paused,plays:[],_muted:muted,get muted(){return this._muted;},set muted(value){this._muted=value;if(!value&&pausesOnUnmute&&!this.paused)this.paused=true;},
  play(){this.plays.push(this._muted);if(blocked&&!this._muted)return Promise.reject(Object.assign(Error('blocked'),{name:'NotAllowedError'}));this.paused=false;return Promise.resolve();}};
 return element;
}

test('playVideo falls back to muted playback when sound is refused',async()=>{
 const element=video({blocked:true,muted:false});
 await playVideo(element);
 assert.deepEqual(element.plays,[false,true]);assert.equal(element.muted,true);assert.equal(element.paused,false);
});

test('playVideo keeps sound when it is allowed and passes other failures through',async()=>{
 const allowed=video({muted:false});await playVideo(allowed);assert.deepEqual(allowed.plays,[false]);assert.equal(allowed.muted,false);
 const aborted={muted:false,play:()=>Promise.reject(Object.assign(Error('aborted'),{name:'AbortError'}))};
 await assert.rejects(playVideo(aborted),{name:'AbortError'});assert.equal(aborted.muted,false);
 const mutedBlocked={muted:true,play:()=>Promise.reject(Object.assign(Error('blocked'),{name:'NotAllowedError'}))};
 await assert.rejects(playVideo(mutedBlocked),{name:'NotAllowedError'});
});

test('setVideoMuted keeps a playing video going when unmuting it is refused',()=>{
 const refused=video({pausesOnUnmute:true,paused:false});
 setVideoMuted(refused,false);
 assert.equal(refused.muted,true);assert.equal(refused.paused,false);assert.deepEqual(refused.plays,[true]);
 const allowed=video({paused:false});setVideoMuted(allowed,false);assert.equal(allowed.muted,false);assert.deepEqual(allowed.plays,[]);
 const paused=video({pausesOnUnmute:true});setVideoMuted(paused,false);assert.equal(paused.muted,false);assert.equal(paused.paused,true);assert.deepEqual(paused.plays,[]);
});
