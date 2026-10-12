import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('first launcher click and tap after reload opens without reaching the underlying page',{timeout:30000},async t=>{
 let chromium;
 try{({chromium}=await import('playwright'));}catch{t.skip('Playwright is unavailable');return;}
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const source=(await readFile(new URL('../userscript/photoswiper-app.user.js',import.meta.url),'utf8')).replace('window:pageWindow,document,location,GM:',"photosCall:async()=>({ok:true,data:{account:'synthetic-account',label:'Synthetic account'}}),window:pageWindow,document,location:{origin:'https://photos.google.com',pathname:'/'},GM:");
  for(const mobile of [false,true]){
   const page=await browser.newPage({viewport:mobile?{width:393,height:852}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='photos-swipe.test'?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
   await page.goto('https://photos-swipe.test');
   await page.reload();
   await page.evaluate(()=>{
    window.WIZ_global_data={SNlM0e:'synthetic-token',oPEP7c:'synthetic@example.test'};
    window.pageInputs=[];
    for(const type of ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup','click'])document.addEventListener(type,event=>window.pageInputs.push(event.type));
    document.addEventListener('mousedown',()=>document.addEventListener('click',event=>event.stopImmediatePropagation(),{capture:true,once:true}));
   });
   await page.addScriptTag({content:source});
   const launcher=page.locator('#launcher'),overlay=page.locator('#overlay');
   assert.equal(await overlay.isVisible(),false);
   if(mobile)await launcher.tap();else await launcher.click();
   await page.waitForFunction(()=>!document.getElementById('photos-swipe-userscript-host').shadowRoot.getElementById('overlay').hidden);
   assert.equal(await overlay.isVisible(),true);
   assert.equal(await launcher.isVisible(),false);
   assert.deepEqual(await page.evaluate(()=>window.pageInputs),[]);
   await page.close();
  }
 }finally{await browser.close();}
});
