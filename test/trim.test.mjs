import test from 'node:test';
import assert from 'node:assert/strict';
import {trimSelection} from '../public/trim-model.js';

test('trim handles stay within the video, cannot cross, and seek to the dragged boundary', () => {
 const selection=trimSelection(77);
 assert.equal(selection.changed,false);
 assert.equal(selection.moveStart(10),10);
 assert.equal(selection.moveEnd(15),15);
 assert.deepEqual(selection.snapshot(),{start:10,end:15,duration:5});
 assert.equal(selection.moveStart(90),14.5);
 assert.equal(selection.moveEnd(-1),15);
 assert.equal(selection.duration,0.5);
 assert.equal(selection.moveEnd(90),77);
 assert.equal(selection.moveStart(-5),0);
 assert.equal(selection.changed,false);
});
test('selected playback loops at the right boundary and never leaks outside the segment', () => {
 const selection=trimSelection(77,10,15);
 for(const time of [0,9.99,15,30,NaN])assert.equal(selection.playbackTime(time),10);
 assert.equal(selection.playbackTime(14.9),14.9);
 assert.equal(selection.changed,true);
});
test('very short videos remain valid and unknown or nonfinite durations cannot be approved', () => {
 const selection=trimSelection(0.2);
 assert.equal(selection.moveStart(0.1),0);
 assert.equal(selection.moveEnd(0.1),0.2);
 for(const duration of [0,-1,NaN,Infinity])assert.throws(()=>trimSelection(duration),/duration/);
 assert.throws(()=>selection.moveStart(NaN),/time/);
});
