import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('deployment requires a supplied or existing pairing secret',()=>{
 const root=mkdtempSync(join(tmpdir(),'photoswiper-deploy-'));
 try{
  for(const directory of ['scripts','worker','bin'])mkdirSync(join(root,directory));
  writeFileSync(join(root,'scripts/deploy-worker.sh'),readFileSync(new URL('../scripts/deploy-worker.sh',import.meta.url)));
  writeFileSync(join(root,'worker/wrangler.toml'),'database_id = "REPLACE_DATABASE_ID"\n');
  writeFileSync(join(root,'bin/node'),'#!/usr/bin/env bash\nif [[ "$1" == "-e" ]]; then\n  exec "$TEST_NODE" "$@"\nfi\nprintf "%s\\n" "$1" >> "$TEST_LOG"\nif [[ "$1" == */sign-release.mjs && "${TEST_SIGN_FAIL:-}" == 1 ]]; then exit 1; fi\n',{mode:0o755});
  writeFileSync(join(root,'bin/npx'),`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG"
if [[ "$3 $4" == "d1 list" ]]; then
 printf '%s\\n' '[{"name":"photoswiper-sync","uuid":"test-database"}]'
fi
if [[ "$3 $4" == "secret list" ]]; then
 printf '%s\\n' "\${TEST_SECRETS:-[]}"
fi
if [[ "$3 $4" == "secret put" ]]; then
 cat > "$TEST_ROOT/$5"
fi
`,{mode:0o755});
  const log=join(root,'commands');
  const base={...process.env,PATH:`${join(root,'bin')}:${process.env.PATH}`,CLOUDFLARE_API_TOKEN:'test-api-token',CLOUDFLARE_ACCOUNT_ID:'test-account',TEST_NODE:process.execPath,TEST_LOG:log,TEST_ROOT:root};
  for(const [supplied,present] of [[true,false],[false,false],[false,true]]){
   writeFileSync(log,'');
   const result=spawnSync('bash',[join(root,'scripts/deploy-worker.sh')],{env:{...base,SYNC_TOKEN:supplied?'test-sync-secret':'',PAIRING_IP_KEY:supplied?'test-pairing-key':'',TEST_SECRETS:JSON.stringify(present?[{name:'PAIRING_IP_KEY',type:'secret_text'}]:[])},encoding:'utf8'});
   assert.equal(result.status,supplied||present?0:1,result.stderr);
   const commands=readFileSync(log,'utf8');
   assert.ok(commands.indexOf('build-userscript.mjs')<commands.indexOf('sign-release.mjs'));
   assert.ok(commands.indexOf('sign-release.mjs')<commands.indexOf('d1 list'));
   assert.match(commands,/d1 migrations apply/);
   assert.match(commands,/secret list --config/);
   assert.equal(commands.includes('deploy --config'),supplied||present);
   if(!supplied&&!present)assert.match(result.stderr,/PAIRING_IP_KEY.*docs\/sync\.md/);
   if(supplied||present)assert.ok(commands.indexOf('secret list --config')<commands.indexOf('deploy --config'));
   for(const [name,value] of [['SYNC_TOKEN','test-sync-secret'],['PAIRING_IP_KEY','test-pairing-key']]){
    assert.equal(commands.includes(`secret put ${name}`),supplied);
    assert.equal(readFileSync(join(root,name),'utf8'),value);
    assert.equal(commands.includes(value),false);
    if(supplied)assert.ok(commands.indexOf(`secret put ${name}`)<commands.indexOf('secret list --config'));
   }
  }
  writeFileSync(log,'');
  const failed=spawnSync('bash',[join(root,'scripts/deploy-worker.sh')],{env:{...base,TEST_SIGN_FAIL:'1'},encoding:'utf8'});
  assert.notEqual(failed.status,0);
  assert.equal(readFileSync(log,'utf8').includes('wrangler'),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
