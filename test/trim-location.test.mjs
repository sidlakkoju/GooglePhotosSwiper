import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalGoogleLocation,verifyRemoteMetadata} from '../lib/trim-verification.mjs';

test('Google E7 latitude/longitude becomes degrees without swapping axes or losing precision',()=>{
 assert.deepEqual(canonicalGoogleLocation([122500000,-932500000]),[12.25,-93.25]);
 assert.deepEqual(canonicalGoogleLocation([-900000000,1800000000]),[-90,180]);
 assert.deepEqual(canonicalGoogleLocation([12.25,-93.25]),[12.25,-93.25]);
 assert.deepEqual(canonicalGoogleLocation([0,0]),[0,0]);assert.equal(canonicalGoogleLocation(null),null);
 for(const invalid of [undefined,[],[1],[1,2,3],[NaN,2],['122500000',-932500000],[122500000.5,-932500000],[910000000,2],[1,1800000001],[91,2],[2,181]])assert.throws(()=>canonicalGoogleLocation(invalid),/location.*format/);
});
test('remote place verification compares normalized E7 to canonical degrees and still rejects wrong/missing place',()=>{
 const job={account:'fixture',name:'generated.MOV',source:{mediaKey:'original',date:null,timezoneOffset:null,location:[12.25,-93.25]},exportReport:{duration:5,width:320,height:180}};
 const remote={account:'fixture',name:job.name,mediaKey:'replacement',date:null,timezoneOffset:null,location:[122500000,-932500000],duration:5,width:320,height:180};
 assert.equal(verifyRemoteMetadata(job,remote),true);assert.equal(verifyRemoteMetadata(job,{...remote,location:job.source.location}),true);
 for(const location of [null,[132500000,-932500000],[-932500000,122500000],[122500000.5,-932500000]])assert.throws(()=>verifyRemoteMetadata(job,{...remote,location}),/location/);
 assert.throws(()=>verifyRemoteMetadata({...job,source:{...job.source,location:null}},remote),/location/);
});
