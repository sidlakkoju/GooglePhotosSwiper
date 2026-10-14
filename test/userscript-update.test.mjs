import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {availableUpdate,claimUpdateReload,consumeOpenAfterUpdate,releaseNewer,updateOrigin,updateTargetKey,openAfterUpdateKey} from '../lib/userscript-update.mjs';

const storage=()=>{const values=new Map();return {values,getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
const respond=(body,ok=true)=>async url=>{assert.ok(url.startsWith(updateOrigin+'/version?t='));return {ok,json:async()=>body};};

test('release comparison is numeric and rejects malformed versions',()=>{
 assert.equal(releaseNewer('1.2.10','1.2.9'),true);
 assert.equal(releaseNewer('1.3.0','1.2.99'),true);
 assert.equal(releaseNewer('1.2.9','1.2.10'),false);
 assert.equal(releaseNewer('1.2.9','1.2.9'),false);
 for(const value of [undefined,null,'','1.2','1.2.x','1.2.3-rc.1'])assert.equal(releaseNewer(value,'1.0.0'),false);
});

test('an available update is reported only for a newer live release',async()=>{
 const timers={setTimeout,clearTimeout};
 assert.equal(await availableUpdate({...timers,fetch:respond({version:'1.2.77'}),version:'1.2.76'}),'1.2.77');
 assert.equal(await availableUpdate({...timers,fetch:respond({version:'1.2.76'}),version:'1.2.76'}),null);
 assert.equal(await availableUpdate({...timers,fetch:respond({version:'1.2.75'}),version:'1.2.76'}),null);
 assert.equal(await availableUpdate({...timers,fetch:respond({version:'1.2.77'},false),version:'1.2.76'}),null);
 assert.equal(await availableUpdate({...timers,fetch:async()=>{throw Error('offline');},version:'1.2.76'}),null);
 assert.equal(await availableUpdate({...timers,fetch:undefined,version:'1.2.76'}),null);
});

test('a stalled update check gives up after its timeout',async()=>{
 const started=Date.now();
 assert.equal(await availableUpdate({setTimeout,clearTimeout,timeout:20,fetch:()=>new Promise(()=>{}),version:'1.2.76'}),null);
 assert.ok(Date.now()-started<1000);
});

test('each target release reloads at most once per tab and reopens after reload',()=>{
 const tab=storage();
 assert.equal(claimUpdateReload(tab,'1.2.77'),true);
 assert.equal(tab.getItem(updateTargetKey),'1.2.77');
 assert.equal(claimUpdateReload(tab,'1.2.77'),false);
 assert.equal(consumeOpenAfterUpdate(tab),true);
 assert.equal(tab.getItem(openAfterUpdateKey),null);
 assert.equal(consumeOpenAfterUpdate(tab),false);
 assert.equal(claimUpdateReload(tab,'1.2.78'),true);
 const blocked={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
 assert.equal(claimUpdateReload(blocked,'1.2.77'),false);
 assert.equal(consumeOpenAfterUpdate(blocked),false);
});

test('the launcher checks for updates and auto-updating builds expose their mode',async()=>{
 const ui=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/\$\('launcher'\)\.onclick=\(\)=>openLatest\(\);/);
 const app=await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8');
 assert.match(app,/autoUpdating:typeof photosSwipeReleaseVersion!=='undefined'/);
 assert.match(app,/function availableUpdate\(/);
});
