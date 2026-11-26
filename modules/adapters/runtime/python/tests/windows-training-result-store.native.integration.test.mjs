// Explicit-only synthetic file fixture. Standard collection has no file effects.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../..');
const enabled=process.argv.includes('--native-feature-child');
const checks=['empty-inventory-sealed','path-mutation-denied','ordered-bounded-writes','verified-native-read','reader-prevents-discard','original-creator-cleanup'];
const sha=value=>createHash('sha256').update(value).digest('hex');
let api,store;
const emptyDiagnostics=()=>({sealStep:0,nativeStatus:0,permissionBits:0,permissionControl:0,grantedAccess:0});

async function run() {
  assert.equal(process.platform,'win32'); assert.equal(process.arch,'x64'); assert.equal(process.argv.length,4);
  const runPath=process.argv[3]; assert.match(runPath,/^artifacts\/tmp\/native-training-result-files\/[a-f0-9]{32}$/);
  const folder=resolve(root,runPath); assert.equal(realpathSync(folder),folder); assert(!lstatSync(folder).isSymbolicLink());
  const request=JSON.parse(readFileSync(resolve(folder,'node-request.json'),'utf8'));
  assert.equal(request.profile,'windows-native-training-result-files-v1');
  assert.equal(realpathSync(process.execPath),realpathSync(request.node.path));
  assert.equal(sha(readFileSync(process.execPath)),request.node.sha256);
  assert.equal(process.versions.node,request.node.version);
  assert.equal(process.env.NODE_OPTIONS,'--preserve-symlinks --preserve-symlinks-main');
  assert.equal(process.env.NODE_PATH,undefined);
  assert.match(request.build,/^artifacts\/tmp\/native-training-result-store\/[a-f0-9]{32}$/);
  const manifest=JSON.parse(readFileSync(resolve(root,request.build,'manifest.json'),'utf8'));
  const source='modules/adapters/filesystem-security/windowsTrainingResultStore.cc';
  assert.equal(manifest.source,source); assert.equal(manifest.source_sha256,sha(readFileSync(resolve(root,source))));
  assert.equal(request.sources[source],manifest.source_sha256);
  const binary=resolve(root,request.build,'training_result_store.node'); assert.equal(realpathSync(binary),binary);
  assert(!lstatSync(binary).isSymbolicLink()); assert.equal(sha(readFileSync(binary)),manifest.binary_sha256);
  assert.equal(request.binary_sha256,manifest.binary_sha256);
  const parent=resolve(folder,'fixture'); assert(!existsSync(parent)); mkdirSync(parent);
  const original=lstatSync(parent,{bigint:true}); const publication=runPath.split('/').at(-1);
  api=createRequire(import.meta.url)(binary);
  store=api.createStore(parent,publication,sha('synthetic-native-training-result-file-fixture-v1'),2,8300,16384,32768,10000);
  const values=[Buffer.from('tiny-config'),Buffer.alloc(8300,0x5a)];
  const inventory=Buffer.alloc(12+44*values.length); inventory.write('ASBTRS01'); inventory.writeUInt32LE(values.length,8);
  values.forEach((value,index)=>{const offset=12+44*index; inventory.writeUInt32LE(index,offset); inventory.writeBigUInt64LE(BigInt(value.length),offset+4); Buffer.from(sha(value),'hex').copy(inventory,offset+12);});
  await api.prepare(store,inventory); assert.equal(api.inspect(store).prepared,true);
  const dataRoot=resolve(parent,publication);
  // Existing controls must reject new path writes; do not alter permissions.
  for(const target of [resolve(dataRoot,'foreign.bin'),resolve(dataRoot,'0.bin'),dataRoot+':foreign',resolve(dataRoot,'0.bin')+':foreign']) {
    assert.throws(()=>writeFileSync(target,Buffer.from('denied')),error=>['EACCES','EPERM','EBUSY'].includes(error.code));
  }
  const denied=call=>assert.throws(call,{code:'TRAINING_RESULT_STORE_DENIED'});
  denied(()=>api.append(store,1,Buffer.from('x')));
  denied(()=>api.append(store,0,Buffer.alloc(8193)));
  for(let index=0;index<values.length;index++) {
    for(let offset=0;offset<values[index].length;offset+=8192) await api.append(store,index,values[index].subarray(offset,offset+8192));
    await api.finishFile(store,index);
  }
  assert.equal(api.inspect(store).completedFiles,2);
  api.fence(store);
  for(let index=0;index<values.length;index++) {
    const reader=api.openReader(store,index); denied(()=>api.discard(store));
    const received=[]; for(let part=0;part<4;part++) {const data=await api.read(reader,8192); if(!data.length)break;received.push(data);}
    assert.deepEqual(Buffer.concat(received),values[index]); api.closeReader(reader);
  }
  await api.discard(store); assert.equal(api.inspect(store).closed,true); assert(!existsSync(dataRoot));
  const observed=lstatSync(parent,{bigint:true}); assert.equal(observed.ino,original.ino);assert.equal(observed.dev,original.dev);
  assert.equal(realpathSync(parent),parent);assert(!observed.isSymbolicLink());assert.deepEqual(readdirSync(parent),[]);
  rmdirSync(parent); // Never recurse or remove an adopted/retained tree.
  assert.equal(relative(root,folder),relative(root,realpathSync(folder)));
  console.log(JSON.stringify({kind:'native-file-result',passed:true,cleanup_passed:true,stage:14,diagnostics:api.inspect(store).diagnostics,checks}));
}

if(enabled) {
  try { await run(); }
  catch {
    let stage=0,diagnostics=emptyDiagnostics(); try {const state=api.inspect(store);stage=state.stage;diagnostics=state.diagnostics;}catch{}
    console.log(JSON.stringify({kind:'native-file-result',passed:false,cleanup_passed:false,stage:Number.isInteger(stage)&&stage>=0&&stage<=14?stage:0,diagnostics,checks:[]}));
    process.exitCode=1;
  }
} else {
  test('actual protected training files require the explicit bounded qualification command',{skip:true},()=>{});
}
