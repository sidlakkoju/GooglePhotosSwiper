import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDate} from '../lib/userscript-core.mjs';

const newYearsEve={date:'2026-01-01T07:30:00.000Z',timezoneOffset:-8*3600000};

test('a photo date is shown in the time zone it was taken in when Google gives the offset',()=>{
 assert.equal(captureDate(newYearsEve,{timeZone:'UTC'}),new Date(Date.UTC(2025,11,31,23,30)).toLocaleDateString(undefined,{timeZone:'UTC'}));
 assert.equal(captureDate(newYearsEve,{month:'long',year:'numeric'}),new Date(Date.UTC(2025,11,31)).toLocaleDateString(undefined,{month:'long',year:'numeric',timeZone:'UTC'}));
 assert.equal(captureDate({date:'2026-06-30T20:00:00.000Z',timezoneOffset:9*3600000}),new Date(Date.UTC(2026,6,1,5)).toLocaleDateString(undefined,{timeZone:'UTC'}));
});

test('without an offset the date keeps the viewer time zone, and a missing date gives nothing',()=>{
 assert.equal(captureDate({date:'2026-01-01T07:30:00.000Z',timezoneOffset:null}),new Date('2026-01-01T07:30:00.000Z').toLocaleDateString());
 assert.equal(captureDate({date:null,timezoneOffset:0}),null);
 assert.equal(captureDate({}),null);
});
