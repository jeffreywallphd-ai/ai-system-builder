// Explicit-only synthetic file fixture. Standard collection has no file effects.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../..');
const enabled=process.argv.includes('--native-feature-child');
const checks=['final-permission-container-creation','complete-inventory-sealed','secondary-control-open-denied','path-and-stream-mutation-denied','ordered-bounded-writes','verified-logical-reads','reader-prevents-discard','original-creator-cleanup'];
const sha=value=>createHash('sha256').update(value).digest('hex');
let api,store,fixtureStep=0,failureCode=0,osErrorCode=0;
const emptyDiagnostics=()=>({sealStep:0,nativeStatus:0,permissionBits:0,permissionControl:0,grantedAccess:0});
const osCodes=Object.freeze(['','EACCES','EPERM','EBUSY','ENOENT','EINVAL','EEXIST','ENOTEMPTY','ENOSPC','EIO']);
export function classifyFilesystemDenial(threw,code) {
  assert.equal(typeof threw,'boolean');
  if(!threw)return Object.freeze({failure_code:1,os_error_code:0});
  if(['EACCES','EPERM','EBUSY'].includes(code))return Object.freeze({failure_code:0,os_error_code:0});
  const index=typeof code==='string' && code.length<=32?osCodes.indexOf(code):-1;
  return Object.freeze({failure_code:2,os_error_code:index>0?index:10});
}
function errorCode(error) {
  try {const property=error && typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code'):undefined;return property && 'value' in property?property.value:undefined;}catch{return undefined;}
}
function expectFilesystemDenial(operation) {
  let threw=false,error;
  try{operation();}catch(value){threw=true;error=value;}
  const result=classifyFilesystemDenial(threw,errorCode(error));
  if(result.failure_code){failureCode=result.failure_code;osErrorCode=result.os_error_code;assert.fail('The fixed filesystem denial check failed.');}
}

async function run() {
  fixtureStep=1;
  assert.equal(process.platform,'win32'); assert.equal(process.arch,'x64'); assert.equal(process.argv.length,4);
  const runPath=process.argv[3]; assert.match(runPath,/^artifacts\/tmp\/native-training-result-files\/[a-f0-9]{32}$/);
  const folder=resolve(root,runPath); assert.equal(realpathSync(folder),folder); assert(!lstatSync(folder).isSymbolicLink());
  const request=JSON.parse(readFileSync(resolve(folder,'node-request.json'),'utf8'));
  assert.equal(request.profile,'windows-native-training-result-container-v2');
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
  fixtureStep=2;
  const parent=resolve(folder,'fixture'); assert(!existsSync(parent)); mkdirSync(parent);
  const original=lstatSync(parent,{bigint:true}); const publication=runPath.split('/').at(-1);
  api=createRequire(import.meta.url)(binary);
  store=api.createStore(parent,publication,sha('synthetic-native-training-result-file-fixture-v1'),2,8300,16384,32768,10000);
  const values=[Buffer.from('tiny-config'),Buffer.alloc(8300,0x5a)];
  const inventory=Buffer.alloc(12+48*values.length); inventory.write('ASBTRS02'); inventory.writeUInt32LE(values.length,8);
  values.forEach((value,index)=>{const offset=12+48*index; inventory.writeUInt32LE(index,offset); inventory.writeUInt16LE(0,offset+4);inventory[offset+6]=2;inventory[offset+7]=index?9:1;inventory.writeBigUInt64LE(BigInt(value.length),offset+8); Buffer.from(sha(value),'hex').copy(inventory,offset+16);});
  fixtureStep=3;await api.prepare(store,inventory); assert.equal(api.inspect(store).prepared,true);
  const dataRoot=resolve(parent,publication+'.asbtr');
  // Existing controls must reject new path writes; do not alter permissions.
  fixtureStep=4;expectFilesystemDenial(()=>writeFileSync(dataRoot,Buffer.from('denied')));
  fixtureStep=5;expectFilesystemDenial(()=>writeFileSync(dataRoot+':foreign',Buffer.from('denied')));
  fixtureStep=6;expectFilesystemDenial(()=>readFileSync(dataRoot));
  fixtureStep=7;expectFilesystemDenial(()=>renameSync(parent,parent+'-moved'));
  const denied=call=>assert.throws(call,{code:'TRAINING_RESULT_STORE_DENIED'});
  fixtureStep=8;denied(()=>api.append(store,1,Buffer.from('x')));
  fixtureStep=9;denied(()=>api.append(store,0,Buffer.alloc(8193)));
  fixtureStep=10;
  for(let index=0;index<values.length;index++) {
    for(let offset=0;offset<values[index].length;offset+=8192) await api.append(store,index,values[index].subarray(offset,offset+8192));
    await api.finishFile(store,index);
  }
  assert.equal(api.inspect(store).completedFiles,2);
  fixtureStep=11;api.fence(store);
  for(let index=0;index<values.length;index++) {
    fixtureStep=12+index;
    const reader=api.openReader(store,index); denied(()=>api.discard(store));
    const received=[]; for(let part=0;part<4;part++) {const data=await api.read(reader,8192); if(!data.length)break;received.push(data);}
    assert.deepEqual(Buffer.concat(received),values[index]); api.closeReader(reader);
  }
  fixtureStep=14;await api.discard(store); assert.equal(api.inspect(store).closed,true); assert(!existsSync(dataRoot));
  fixtureStep=15;
  const observed=lstatSync(parent,{bigint:true}); assert.equal(observed.ino,original.ino);assert.equal(observed.dev,original.dev);
  assert.equal(realpathSync(parent),parent);assert(!observed.isSymbolicLink());assert.deepEqual(readdirSync(parent),[]);
  rmdirSync(parent); // Never recurse or remove an adopted/retained tree.
  assert.equal(relative(root,folder),relative(root,realpathSync(folder)));
  fixtureStep=16;console.log(JSON.stringify({kind:'native-file-result',passed:true,cleanup_passed:true,stage:14,diagnostics:api.inspect(store).diagnostics,fixture_step:fixtureStep,failure_code:0,os_error_code:0,checks}));
}

if(enabled) {
  try { await run(); }
  catch(error) {
    let stage=0,diagnostics=emptyDiagnostics(); try {const state=api.inspect(store);stage=state.stage;diagnostics=state.diagnostics;}catch{}
    if(!failureCode){const code=errorCode(error);failureCode=code==='ERR_ASSERTION'?3:code==='TRAINING_RESULT_STORE_DENIED'?4:5;}
    console.log(JSON.stringify({kind:'native-file-result',passed:false,cleanup_passed:false,stage:Number.isInteger(stage)&&stage>=0&&stage<=14?stage:0,diagnostics,fixture_step:fixtureStep,failure_code:failureCode,os_error_code:osErrorCode,checks:[]}));
    process.exitCode=1;
  }
} else {
  test('actual protected training files require the explicit bounded qualification command',{skip:true},()=>{});
}
