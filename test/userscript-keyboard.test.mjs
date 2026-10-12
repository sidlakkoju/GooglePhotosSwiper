import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../lib/userscript-ui.mjs',import.meta.url),'utf8');

function fixture(){
 let time=1000;
 const listeners={},decisions=[],root={},document={},sheet={hidden:true},dialog={hidden:true};
 const nodes={overlay:{hidden:false},card:{classList:{contains:()=>false}},media:{querySelector:()=>null}};
 const context=vm.createContext({Date:{now:()=>time},window:{addEventListener:(type,handler)=>listeners[type]=handler},document,root,sheet,pairingModal:{modal:dialog,close(){dialog.hidden=true;context.suppressViewerShortcuts();}},receivingPanel:null,$:id=>nodes[id],reviewPanel:{hidden:true},close(){},toggleEnlarge(){},undo(){},decide:decision=>decisions.push(decision),closeSettings(){sheet.hidden=true;root.activeElement={tagName:'BUTTON'};context.suppressViewerShortcuts();}});
 vm.runInContext(source.slice(source.indexOf(' let viewerShortcutsBlockedUntil='),source.indexOf(' const pairingModal='))+'\nglobalThis.suppressViewerShortcuts=suppressViewerShortcuts;',context);
 vm.runInContext(source.slice(source.indexOf(' const activePairingDialog='),source.lastIndexOf('\n}')),context);
 const press=(key,extra={})=>listeners.keydown({key,type:'keydown',preventDefault(){},stopImmediatePropagation(){},...extra});
 return {context,root,document,sheet,dialog,decisions,press,setTime:value=>time=value};
}

test('decision shortcuts ignore focused fields throughout the page and composed event path',()=>{
 const f=fixture();
 for(const field of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{isContentEditable:true}]){
  for(const owner of [f.root,f.document]){
   owner.activeElement=field;f.press('ArrowLeft');f.press('ArrowRight');owner.activeElement=null;
  }
  f.press('ArrowLeft',{target:field});f.press('ArrowRight',{composedPath:()=>[field,{}]});
  f.document.activeElement={shadowRoot:{activeElement:field}};f.press('ArrowRight');f.document.activeElement=null;
 }
 assert.deepEqual(f.decisions,[]);
 f.press('ArrowLeft');f.press('ArrowRight');assert.deepEqual(f.decisions,['remove','keep']);
});

test('Escape closing settings suppresses subsequent decisions for 500 ms and preserves repeated-key protection',()=>{
 const f=fixture();f.sheet.hidden=false;
 f.press('ArrowLeft');f.press('ArrowRight');f.press('Escape');
 assert.equal(f.sheet.hidden,true);
 f.press('ArrowLeft');f.setTime(1499);f.press('ArrowRight');assert.deepEqual(f.decisions,[]);
 f.setTime(1500);f.press('ArrowRight',{repeat:true});assert.deepEqual(f.decisions,[]);
 f.press('ArrowRight');assert.deepEqual(f.decisions,['keep']);
});

test('pairing dialog blocks decisions and closing it starts the same grace period',()=>{
 const f=fixture();f.dialog.hidden=false;f.dialog.contains=()=>true;
 f.press('ArrowLeft');f.press('ArrowRight');f.press('Escape');
 f.press('ArrowRight');f.setTime(1499);f.press('ArrowLeft');assert.deepEqual(f.decisions,[]);
 f.setTime(1500);f.press('ArrowLeft');assert.deepEqual(f.decisions,['remove']);
});
