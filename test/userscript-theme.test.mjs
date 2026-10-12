import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');
const css=JSON.parse(source.match(/styleElement1\.append\(document\.createTextNode\((".*")\)\);/)[1]);
const light=css.match(/:host\{([^}]+)\}/)[1];
const dark=css.match(/@media\(prefers-color-scheme:dark\)\{:host\{([^}]+)\}\}/)[1];

test('shadow host defines the design palette for both device appearances',()=>{
 const palette={bg:['#F2F2F7','#000'],surface:['rgba(255,255,255,.72)','rgba(28,28,30,.72)'],'surface-solid':['#FFF','#1C1C1E'],fill:['rgba(120,120,128,.12)','rgba(120,120,128,.24)'],label:['#000','#FFF'],label2:['rgba(60,60,67,.6)','rgba(235,235,245,.6)'],sep:['rgba(60,60,67,.18)','rgba(84,84,88,.6)'],accent:['#007AFF','#0A84FF'],destructive:['#FF3B30','#FF453A']};
 for(const [name,values] of Object.entries(palette))for(const [index,theme] of [light,dark].entries())assert.ok(theme.includes(`--ps-${name}:${values[index]};`),`${name} theme ${index}`);
 assert.match(light,/color-scheme:light/);
 assert.match(light,/all:initial;.*font:var\(--ps-t-body\)/);
 assert.doesNotMatch(source,/host\.style\.cssText='all:/);
 assert.match(dark,/color-scheme:dark/);
 for(const [index,value] of [4,8,12,16,24,32].entries())assert.ok(light.includes(`--ps-s${index+1}:${value}px;`));
 for(const [name,value] of Object.entries({sm:10,md:16,lg:24,pill:999}))assert.ok(light.includes(`--ps-r-${name}:${value}px;`));
 for(const [name,value] of Object.entries({large:'600 28px/34px',title:'600 20px/25px',body:'400 17px/22px',callout:'500 15px/20px',caption:'400 12px/16px'}))assert.ok(light.includes(`--ps-t-${name}:${value} var(--ps-font)`));
});

test('UI colors are tokenized, including empty media and decision stamps',()=>{
 const declarations=css.replace(/--ps-[\w-]+:[^;{}]+;/g,'');
 assert.doesNotMatch(declarations,/#(?:[\da-f]{3,8})\b|\brgba?\(|\b(?:white|black|green)\b(?!-)/i);
 assert.doesNotMatch(source,/green|#(?:193426|e3ebdf|236541|245b3d|13281f|264638|34c759|30d158)/i);
 assert.match(source,/style\.color='var\(--ps-label\)'/);
 for(const [decision,token] of [['keep','accent'],['remove','destructive']])assert.match(source,new RegExp(`\\.stamp-${decision}\\{[^}]*color:var\\(--ps-${token}\\)`));
 assert.match(source,/border:4px solid currentColor/);
 assert.doesNotMatch(css,/\.stamp\[data-decision=/);
});

test('controls use system typography and explicit cross-browser styling',()=>{
 assert.match(light,/--ps-font:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,Inter,sans-serif/);
 assert.match(css,/button,select,input\{[^}]*font:var\(--ps-t-callout\);appearance:none;-webkit-appearance:none/);
 assert.match(css,/input:focus-visible\{outline:3px solid var\(--ps-accent\)/);
 for(const selector of ['input[type=checkbox]:checked','input[type=range]::-webkit-slider-thumb','input[type=range]::-moz-range-thumb'])assert.ok(css.includes(selector));
});

test('blurred surfaces retain an opaque fallback without backdrop-filter support',()=>{
 const supported=css.indexOf('@supports');
 assert.ok(supported>0);
 assert.match(css.slice(0,supported),/\.album-controls,#sync-settings\{background:var\(--ps-surface-solid\)/);
 assert.match(css.slice(supported),/@supports \(\(backdrop-filter:blur\(20px\)\) or \(-webkit-backdrop-filter:blur\(20px\)\)\)/);
 assert.match(css.slice(supported),/background:var\(--ps-surface\);backdrop-filter:blur\(20px\);-webkit-backdrop-filter:blur\(20px\)/);
});

test('compacted rules preserve control, caption, queue and decision styling',()=>{
 const rule=selector=>css.split('}').map(block=>block.split('{')).find(([name])=>name===selector)[1];
 assert.match(rule('button,select,input'),/color:var\(--ps-label\);background:var\(--ps-surface-solid\);border:1px solid var\(--ps-sep\);border-radius:var\(--ps-r-sm\)/);
 assert.equal(rule('button'),'min-height:44px;border:0;background:var(--ps-fill);padding:10px 16px;cursor:pointer');
 assert.equal(rule('.caption'),'padding:10px 14px');
 assert.match(rule('.queue span'),/font:var\(--ps-t-caption\)/);
 assert.equal(rule('.keep,.remove'),'background:var(--ps-surface-solid)');
 assert.equal(rule('.keep'),'color:var(--ps-accent)');
 assert.equal(rule('.remove'),'color:var(--ps-destructive)');
 assert.match(css,/\.media\{touch-action:none;/);
 assert.match(css,/\.card.expanded \.media\{touch-action:pan-x pan-y pinch-zoom;/);
 assert.doesNotMatch(css,/overflow:hidden;position:relative|\.album-controls\{background:|\.queue span\{font:/);
});
