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
 assert.match(css,/\.card.expanded \.media\{height:72vh;/);
 assert.doesNotMatch(css,/overflow:hidden;position:relative|\.album-controls\{background:|\.queue span\{font:/);
});

const glass=source.match(/glassStyle\.textContent=`([^`]*)`/)[1];
const glassBlock=(start)=>{const from=glass.indexOf(start);let depth=0;for(let index=glass.indexOf('{',from);index<glass.length;index++){if(glass[index]==='{')depth++;if(glass[index]==='}'&&!--depth)return glass.slice(from,index+1);}return '';};

test('liquid glass materials, tints and photo chips are tokenized for both appearances',()=>{
 for(const name of ['glass-fill','glass-fill-strong','glass-stroke','glass-shadow','glass-tint-blue','glass-tint-red','glass-solid','glass-scrim','photo-chip','photo-label','ambient-dim'])for(const theme of [light,dark])assert.match(theme,new RegExp(`--ps-${name}:`),name);
 for(const [name,value] of Object.entries({clear:'blur(6px) saturate(180%)',regular:'blur(20px) saturate(160%)',thick:'blur(40px) saturate(140%)'}))assert.ok(light.includes(`--ps-blur-${name}:${value};`),name);
 assert.ok(dark.includes('--ps-glass-fill:rgba(255,255,255,.07);')&&dark.includes('--ps-glass-fill-strong:rgba(255,255,255,.14);')&&dark.includes('--ps-glass-stroke:rgba(255,255,255,.22);'));
 assert.ok(dark.includes('--ps-glass-tint-blue:rgba(10,132,255,.62);')&&dark.includes('--ps-glass-tint-red:rgba(255,69,58,.58);'));
 assert.match(light,/--ps-glass-fill:rgba\(255,255,255,\.55\);.*--ps-photo-label:#000;/);
 assert.doesNotMatch(glass,/#(?:[\da-f]{3,8})\b|\brgba?\(|\b(?:white|black)\b/i,'glass rules use tokens only');
});

test('the page behind the overlay is no longer blurred; an ambient copy of the photo replaces it',()=>{
 assert.doesNotMatch(source,/blur\(12px\)|rgba\(0,0,0,\.55\);backdrop-filter/);
 assert.match(source,/\.overlay\{scrollbar-gutter:auto;display:flex;align-items:center;justify-content:center;background:var\(--ps-bg\)/);
 assert.match(glass,/\.ambient\{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none/);
 assert.doesNotMatch(glassBlock('.ambient canvas{'),/filter/,'the ambient layer is a pre-blurred tiny canvas, never a filtered full-size image');
 assert.match(source,/mediaURL\(item\.thumbUrl,false,\{width:64,height:64\}\)/);
});

test('blurred glass keeps an opaque fallback and a reduced-transparency fallback',()=>{
 const supported=glass.indexOf('@supports');
 assert.ok(supported>0);
 for(const selector of ['.content .actions{','.content .storage-counter{','.share-sheet{'])assert.match(glass.slice(0,supported),new RegExp(selector.replace(/[.{]/g,character=>'\\'+character)+'[^}]*background:var\\(--ps-glass-solid\\)'),selector);
 const glassy=glassBlock('@supports');
 assert.match(glassy,/backdrop-filter:var\(--ps-blur-regular\);-webkit-backdrop-filter:var\(--ps-blur-regular\)/);
 assert.match(glassy,/backdrop-filter:var\(--ps-blur-thick\);-webkit-backdrop-filter:var\(--ps-blur-thick\)/);
 assert.doesNotMatch(glass.slice(0,supported),/backdrop-filter:var/,'blur only applies where it is supported');
 const reduced=glassBlock('@media (prefers-reduced-transparency:reduce)');
 assert.match(reduced,/\.content \.actions,[^{]*\{background:var\(--ps-glass-solid\);backdrop-filter:none;-webkit-backdrop-filter:none\}/);
 assert.match(glassBlock('@media (prefers-reduced-motion:reduce)'),/\.ambient canvas\{transition:none\}/);
});

test('the dragged card and the dock buttons never get their own backdrop blur',()=>{
 const glassy=glassBlock('@supports');
 assert.doesNotMatch(glassy,/top-card|#card|\.media|memory-label|card-tool|#enlarge|#remove|#keep|#undo|trash-check/);
 for(const selector of ['.memory-label{','.card-tool,#enlarge{'])assert.match(glassBlock(selector),/backdrop-filter:none;-webkit-backdrop-filter:none/,selector);
 assert.match(glass,/\.actions #keep\{background:var\(--ps-glass-tint-blue\)/);
 assert.match(glass,/\.actions #remove\{background:var\(--ps-glass-fill-strong\);color:var\(--ps-destructive\)\}/);
 assert.match(glass,/\.trash-bar #move-trash,\.trash-bar \.preview-trash\{background:var\(--ps-glass-tint-red\)/);
 assert.match(glass,/#card>\.under-card\{opacity:0\}\n#card>\.under-card\.peek\{opacity:1\}/);
});

test('inline styles written on every drag frame never feed a :has() selector',()=>{
 for(const match of source.matchAll(/:has\(([^{]*)\)/g))assert.doesNotMatch(match[1],/\[style/,match[0]);
});

test('the hidden video spinner does not animate while idle',()=>{
 const spinner=source.match(/\.video-spinner\{position:absolute[^}]*\}/)[0];
 assert.match(spinner,/animation:ps-spin [^;}]*infinite paused/);
 assert.match(source,/#card\.video-loading \.video-spinner\{[^}]*animation-play-state:running/);
});

test('touch devices tint, rather than re-blur, glass that only ever sits over the pre-blurred ambient',()=>{
 for(const [name,value] of Object.entries({regular:'saturate(160%)',thick:'saturate(140%)'}))assert.ok(light.includes(`--ps-tint-${name}:${value};`),name);
 const touch=glassBlock('@supports').match(/@media \(pointer:coarse\)\{([\s\S]*)\}\s*\}$/)[1];
 assert.match(touch,/\.content \.actions\{backdrop-filter:var\(--ps-tint-regular\);-webkit-backdrop-filter:var\(--ps-tint-regular\)\}/);
 assert.match(touch,/\.settings-sheet,\.review-panel\{backdrop-filter:var\(--ps-tint-thick\);-webkit-backdrop-filter:var\(--ps-tint-thick\)\}/);
 assert.doesNotMatch(touch,/order-menu|share-sheet|pair-onboarding|settings-header|trash-preview|trash-done/,'surfaces that can sit over a photo or scrolling content keep their blur');
 assert.ok(glass.indexOf('@media (pointer:coarse)')<glass.indexOf('@media (prefers-reduced-transparency:reduce)'),'reduced transparency still wins');
});

test('every safe-area inset goes through one host variable per edge',()=>{
 for(const edge of ['top','right','bottom','left'])assert.ok(light.includes(`--ps-safe-${edge}:env(safe-area-inset-${edge},0px);`),edge);
 assert.equal(source.match(/env\(safe-area-inset/g).length,4);
 assert.match(source,/var\(--ps-safe-top\)/);
 assert.match(glass,/\.overlay\{background:var\(--ps-chrome\)\}\n\.ambient\{[^}]*background:var\(--ps-chrome\)\}/);
 assert.match(light,/--ps-chrome:#DCDCE1;/);assert.match(dark,/--ps-chrome:#1C1C1E;/);
});
