import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const native = process.argv.includes('--native-abi');
const sourcePath = 'modules/adapters/filesystem-security/windowsTrainingResultStore.cc';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(resolve(root, sourcePath), 'utf8');

test('the parent native custodian stays outside default host composition', () => {
  assert.match(source, /NAPI_VERSION 8/);
  assert.match(source, /napi_type_tag_object/);
  assert.match(source, /napi_create_async_work/);
  assert.equal(/\b(?:CreateProcess|ShellExecute|DeleteFile|RemoveDirectory|SetNamedSecurityInfo|LoadLibrary)[A-Za-z]*\s*\(|\bsystem\s*\(/.test(source), false);
  assert.match(source, /Original output slot|ORIGINAL output slot/);
  assert.match(source, /No path deletion/);
});

test('real compiled private ABI rejects forged handles and invalid input before file effects', {skip: !native}, async () => {
  assert.equal(process.platform, 'win32', 'The fixed native ABI profile requires Windows.');
  assert.equal(process.arch, 'x64');
  assert.equal(process.versions.node.split('.')[0], '24');
  assert(Number(process.versions.napi) >= 8, 'The addon uses stable Node-API 8; SDK and host patch versions can differ.');
  const build = spawnSync('python', ['-B','dev-tools/scripts/native/build_windows_training_result_store.py'], {
    cwd:root, encoding:'utf8', windowsHide:true, timeout:180000, maxBuffer:1024*1024,
  });
  assert.equal(build.error, undefined, 'Fixed build subprocess must return.');
  assert.equal(build.status, 0, 'Fixed compiler must pass; retain its build.log on failure.');
  const result = JSON.parse(build.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(result.cleanup_passed, true);
  assert.equal(result.physical_exit_code, 0);
  assert.match(result.build, /^artifacts\/tmp\/native-training-result-store\/[a-f0-9]{32}$/);
  const folder = resolve(root, result.build);
  const manifest = JSON.parse(readFileSync(resolve(folder,'manifest.json'),'utf8'));
  assert.equal(manifest.schema, 'windows-training-result-build-v1');
  assert.equal(manifest.source, sourcePath);
  assert.equal(manifest.source_sha256, sha(readFileSync(resolve(root,sourcePath))));
  const binary = resolve(folder,'training_result_store.node');
  assert.equal(lstatSync(binary).isSymbolicLink(),false);
  assert.equal(realpathSync(binary),binary);
  assert.equal(manifest.binary_sha256,sha(readFileSync(binary)));
  assert.equal(result.binary_sha256,manifest.binary_sha256);
  for(const [path,digest] of Object.entries(manifest.inputs)) {
    if(isAbsolute(path) || path.startsWith('../')) continue;
    // Toolchain include labels are logical names; repository inputs are paths.
    if(!['modules/','dev-tools/'].some(prefix=>path.startsWith(prefix))) continue;
    assert(!relative(root,resolve(root,path)).startsWith('..'));
    assert.equal(sha(readFileSync(resolve(root,path))),digest);
  }
  const api = createRequire(import.meta.url)(binary);
  assert(Object.isFrozen(api));
  assert.deepEqual(Object.getOwnPropertyNames(api).sort(), ['append','closeReader','createStore','discard','fence','finishFile','inspect','openReader','prepare','read'].sort());
  const config = ['C:\\unused-training-abi-parent', 'a'.repeat(32), 'b'.repeat(64), 2, 8192, 16384, 16384, 1000];
  const denied = fn => assert.throws(fn, {code:'TRAINING_RESULT_STORE_DENIED'});
  for(const invalid of [[],[...config,0],['relative',...config.slice(1)],['C:\\bad\\..\\parent',...config.slice(1)],['C:\\CON',...config.slice(1)],['C:\\parent\\',...config.slice(1)]]) denied(()=>api.createStore(...invalid));
  for(const [index,value] of [[1,'A'.repeat(32)],[2,'g'.repeat(64)],[3,257],[3,NaN],[4,0],[5,8191],[6,4095],[7,120001]]) {
    const values=[...config]; values[index]=value; denied(()=>api.createStore(...values));
  }
  const store=api.createStore(...config);
  assert(Object.isFrozen(store));
  assert.deepEqual(api.inspect(store), {pending:false,fenced:false,uncertain:false,prepared:false,closed:false,completedFiles:0,readers:0,stage:0});
  for(const fake of [{}, {...store}, JSON.parse(JSON.stringify(store)), new Proxy(store,{})]) {
    for(const call of [()=>api.inspect(fake),()=>api.fence(fake),()=>api.prepare(fake,Buffer.alloc(12)),()=>api.openReader(fake,0),()=>api.read(fake,1),()=>api.discard(fake)]) denied(call);
  }
  for(const malformed of [Buffer.alloc(0),Buffer.alloc(12),new Uint8Array(12),Buffer.concat([Buffer.from('ASBTRS01'),Buffer.alloc(4)]),Buffer.alloc(12+44*257)]) denied(()=>api.prepare(store,malformed));
  const inventory=Buffer.alloc(56); inventory.write('ASBTRS01'); inventory.writeUInt32LE(1,8);
  denied(()=>api.prepare(store,inventory)); // zero-byte file cannot dispatch
  inventory.writeUInt32LE(1,12); inventory.writeBigUInt64LE(1n,16); denied(()=>api.prepare(store,inventory));
  inventory.writeUInt32LE(0,12); inventory.writeBigUInt64LE(8193n,16); denied(()=>api.prepare(store,inventory));
  assert.equal(api.inspect(store).uncertain,false,'Parser denials must not claim a native operation occurred.');
  for(const call of [()=>api.append(store,0,Buffer.from('x')),()=>api.finishFile(store,0),()=>api.openReader(store,0),()=>api.read(store,1),()=>api.closeReader(store),()=>api.discard(store)]) denied(call);
  api.fence(store); denied(()=>api.prepare(store,inventory));
  const closing=api.discard(store); assert.equal(api.inspect(store).pending,true); denied(()=>api.discard(store));
  await closing;
  assert.deepEqual(api.inspect(store),{pending:false,fenced:true,uncertain:false,prepared:false,closed:true,completedFiles:0,readers:0,stage:14});
  denied(()=>api.discard(store));
  // Known no-file retirement returns a registry slot; GC never closes a live one.
  for(let i=0;i<40;i++) { const item=api.createStore(...config); api.fence(item); await api.discard(item); }
  const owners=Array.from({length:32},()=>api.createStore(...config)); denied(()=>api.createStore(...config));
  for(const item of owners) { api.fence(item); await api.discard(item); }
});
