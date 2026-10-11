import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('deployment installs supplied secrets and preserves omitted secrets',()=>{
 const root=mkdtempSync(join(tmpdir(),'photoswiper-deploy-'));
 try{
  for(const directory of ['scripts','worker','bin'])mkdirSync(join(root,directory));
  writeFileSync(join(root,'scripts/deploy-worker.sh'),readFileSync(new URL('../scripts/deploy-worker.sh',import.meta.url)));
  writeFileSync(join(root,'worker/wrangler.toml'),'database_id = "REPLACE_DATABASE_ID"\n');
  writeFileSync(join(root,'bin/node'),'#!/usr/bin/env bash\nif [[ "$1" == "-e" ]]; then\n  exec "$TEST_NODE" "$@"\nfi\n',{mode:0o755});
  writeFileSync(join(root,'bin/npx'),`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG"
if [[ "$3 $4" == "d1 list" ]]; then
 printf '%s\\n' '[{"name":"photoswiper-sync","uuid":"test-database"}]'
fi
if [[ "$3 $4" == "secret put" ]]; then
 cat > "$TEST_ROOT/$5"
fi
`,{mode:0o755});
  const log=join(root,'commands');
  const base={...process.env,PATH:`${join(root,'bin')}:${process.env.PATH}`,CLOUDFLARE_API_TOKEN:'test-api-token',CLOUDFLARE_ACCOUNT_ID:'test-account',TEST_NODE:process.execPath,TEST_LOG:log,TEST_ROOT:root};
  for(const supplied of [true,false]){
   writeFileSync(log,'');
   const result=spawnSync('bash',[join(root,'scripts/deploy-worker.sh')],{env:{...base,SYNC_TOKEN:supplied?'test-sync-secret':'',PAIRING_IP_KEY:supplied?'test-pairing-key':''},encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
   const commands=readFileSync(log,'utf8');
   assert.match(commands,/d1 migrations apply/);
   assert.match(commands,/deploy --config/);
   for(const [name,value] of [['SYNC_TOKEN','test-sync-secret'],['PAIRING_IP_KEY','test-pairing-key']]){
    assert.equal(commands.includes(`secret put ${name}`),supplied);
    assert.equal(readFileSync(join(root,name),'utf8'),value);
    assert.equal(commands.includes(value),false);
    if(supplied)assert.ok(commands.indexOf(`secret put ${name}`)<commands.indexOf('deploy --config'));
   }
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
