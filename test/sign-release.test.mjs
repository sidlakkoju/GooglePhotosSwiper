import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('release signing fails for a missing key or a key different from the pin',()=>{
 const directory=mkdtempSync(join(tmpdir(),'photoswiper-sign-'));
 try{
  const path=join(directory,'ephemeral.key');
  const run=()=>spawnSync(process.execPath,['scripts/sign-release.mjs'],{env:{...process.env,PHOTOSWIPER_SIGNING_KEY:path},encoding:'utf8'});
  const missing=run();assert.notEqual(missing.status,0);assert.match(missing.stderr,/ENOENT/);
  writeFileSync(path,generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}));
  const wrong=run();assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/does not match/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
