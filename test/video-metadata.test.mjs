import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {formatBytes} from '../public/model.js';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');

function reviewCard(){
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{dataset:{},textContent:''});
  return elements.get(id);
 };
 const context=vm.createContext({$,formatBytes,showMedia(){}});
 for(const name of ['date','renderCard'])vm.runInContext(app.split('\n').find(line=>line.startsWith(`function ${name}(`)),context);
 return {context,$};
}

test('synthetic video cards show filename, date and size and reset for photos',()=>{
 const {context,$}=reviewCard();
 const video={id:'fake-video',type:'video',name:'Synthetic clip.mp4',date:'2026-10-10T12:00:00Z',size:12500000,width:1920,height:1080,duration:16000,url:'/fake-video-poster.png'};
 context.renderCard(video);
 assert.equal($('card').dataset.mediaType,'video');
 assert.equal($('photo-name').textContent,video.name);
 assert.equal($('photo-date').textContent,context.date(video.date));
 assert.equal($('photo-details').textContent,'12.5 MB · 1920 × 1080 · VIDEO · 16s');
 assert.equal($('media-badge').textContent,'▷ VIDEO');
 context.renderCard({id:'fake-photo',type:'photo',name:'Synthetic photo.jpg',url:'/fake-photo.jpg'});
 assert.equal($('card').dataset.mediaType,'photo');
 assert.equal($('photo-name').textContent,'Synthetic photo.jpg');
 assert.equal($('photo-date').textContent,'Date unavailable');
 assert.equal($('photo-details').textContent,'File size unavailable · PHOTO');
 context.renderCard({id:'fake-video-unknown',type:'video',name:'Unknown clip.mp4',url:'/fake-video-poster.png'});
 assert.equal($('photo-date').textContent,'Date unavailable');
 assert.equal($('photo-details').textContent,'File size unavailable · VIDEO');
});

test('video metadata has a visible footer outside the player and its native controls',()=>{
 const rule=selector=>css.slice(css.indexOf(selector+'{')+selector.length+1).split('}')[0];
 assert.match(rule('.photo-card[data-media-type=video]'),/display:flex;flex-direction:column/);
 assert.match(rule('.photo-card[data-media-type=video] #media'),/position:relative;flex:1;min-height:0/);
 assert.match(rule('.photo-card[data-media-type=video] .photo-meta'),/position:relative;flex:none/);
 assert.doesNotMatch(css,/\.photo-card:has\(video\) \.photo-meta\{display:none\}/);
});
