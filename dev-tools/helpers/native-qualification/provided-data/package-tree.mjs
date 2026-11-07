// Fixed local qualification template. The checked-in context grants no effects.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, open, opendir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const FIXED_CONTEXT = null;
export const treeCaps = Object.freeze({files:4096, directories:1024, totalBytes:2*1024**3,
  fileBytes:512*1024**2, depth:24, pathBytes:768});
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const emptyGpuDirectories = Object.freeze(['resources/worker/ocr/native/build/NVIDIA Corporation',
  'resources/worker/ocr/native/build/NVIDIA Corporation/umdlogs']);
const shaPattern = /^[a-f0-9]{64}$/;
const same = (a,b) => a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
  a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs && a.nlink===b.nlink;
const exact = (value, keys) => assert.ok(value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key)), 'Invalid fixed object.');

// Preserve normal canonical identities in records. Node's filesystem adapter
// receives extended Windows syntax only at these exact I/O boundaries.
export function ioPath(file) {
  assert.ok(typeof file==='string' && path.isAbsolute(file), 'Absolute path required.');
  if (process.platform==='win32') {
    assert.match(file,/^[A-Za-z]:[\\/]/);
    assert.ok(file.split(/[\\/]/).slice(1).filter(Boolean).every(part=>part!=='.' && part!=='..' && !/[. ]$/.test(part)));
  }
  assert.equal(path.resolve(file),file);
  // This Windows runtime rejects a namespaced bare drive root. This exact
  // short anchor still receives the ordinary-directory check using C:\ form.
  return path.parse(file).root===file ? file : path.toNamespacedPath(file);
}
const normal = value => process.platform==='win32' && /^\\\\\?\\[A-Za-z]:\\/.test(value) ? value.slice(4) : value;
export async function ordinary(file, directory=false) {
  assert.equal(path.resolve(normal(await realpath(ioPath(file)))),file, 'Redirected path.');
  let current=file;
  for (;;) {
    const info=await lstat(ioPath(current),{bigint:true});
    assert.ok(!info.isSymbolicLink());
    if (current!==file || directory) assert.ok(info.isDirectory());
    else assert.ok(info.isFile() && info.nlink===1n);
    const parent=path.dirname(current); if (parent===current) break; current=parent;
  }
  return lstat(ioPath(file),{bigint:true});
}

async function admitted(file, limit, collect) {
  assert.ok(Number.isSafeInteger(limit) && limit>0 && limit<=treeCaps.fileBytes);
  const before=await ordinary(file);
  assert.ok(before.size<=BigInt(limit), 'File exceeds bound.');
  const handle=await open(ioPath(file),'r');
  try {
    assert.ok(same(before,await handle.stat({bigint:true})), 'Opened identity changed.');
    const digest=createHash('sha256'), buffer=Buffer.alloc(Math.min(65536,limit+1)), blocks=[];
    let bytes=0;
    for (;;) {
      const read=await handle.read(buffer,0,Math.min(buffer.length,limit-bytes+1),null);
      if (!read.bytesRead) break;
      bytes+=read.bytesRead; assert.ok(bytes<=limit, 'Growing file exceeds bound.');
      const part=buffer.subarray(0,read.bytesRead); digest.update(part);
      if (collect) blocks.push(Buffer.from(part));
    }
    assert.equal(BigInt(bytes),before.size);
    assert.ok(same(before,await handle.stat({bigint:true})) && same(before,await ordinary(file)), 'File changed while read.');
    return {bytes,sha256:digest.digest('hex'),...(collect?{raw:Buffer.concat(blocks,bytes)}:{})};
  } finally { await handle.close(); }
}
export async function fixedRegularDigest(file, limit) { return admitted(file,limit,false); }
export async function boundedRead(file, limit, expected) {
  if (expected!==undefined) assert.match(expected,shaPattern);
  const result=await admitted(file,limit,true);
  if (expected!==undefined) assert.equal(result.sha256,expected);
  return result.raw;
}

/** Detect duplicates before JSON.parse can discard them; cap depth and bytes. */
export function parseStrictJson(raw, cap=2*1024**2) {
  assert.ok(Buffer.isBuffer(raw) && Number.isSafeInteger(cap) && cap>0 && raw.length<=cap);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw); let cursor=0;
  const space=()=>{while (/^[\t\r\n ]$/.test(text[cursor]??'')) cursor++;};
  function string() {
    const start=cursor; assert.equal(text[cursor++],'"');
    for (;;) {
      assert.ok(cursor<text.length, 'Unterminated JSON string.');
      const char=text[cursor++];
      if (char==='"') return JSON.parse(text.slice(start,cursor));
      if (char==='\\') { assert.ok(cursor<text.length); cursor++; }
    }
  }
  function value(depth) {
    assert.ok(depth<=128, 'JSON depth bound.'); space(); const first=text[cursor];
    if (first==='"') { string(); return; }
    if (first==='{' || first==='[') {
      const object=first==='{', end=object?'}':']', keys=new Set(); cursor++; space();
      if (text[cursor]===end) { cursor++; return; }
      for (;;) {
        space();
        if (object) { const key=string(); assert.ok(!keys.has(key), 'Duplicate JSON field.'); keys.add(key); space(); assert.equal(text[cursor++],':'); }
        value(depth+1); space(); const next=text[cursor++];
        if (next===end) return;
        assert.equal(next,',');
      }
    }
    const match=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(cursor));
    assert.ok(match, 'Invalid JSON value.');
    if (/^-?[0-9]/.test(match[0])) assert.ok(Number.isFinite(Number(match[0])), 'Nonfinite JSON number.');
    cursor+=match[0].length;
  }
  value(0); space(); assert.equal(cursor,text.length); return JSON.parse(text);
}
export async function readJson(file,cap=2*1024**2,expected) { return parseStrictJson(await boundedRead(file,cap,expected),cap); }
export async function writeFresh(file,value,cap=65536) {
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
  assert.ok(raw.length<=cap); parseStrictJson(raw,cap);
  await ordinary(path.dirname(file),true);
  const handle=await open(ioPath(file),'wx');
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
  return hash(raw);
}
export async function boundedNames(folder, cap=treeCaps.files+treeCaps.directories) {
  assert.ok(Number.isSafeInteger(cap) && cap>0 && cap<=treeCaps.files+treeCaps.directories);
  await ordinary(folder,true); const names=[];
  for await (const entry of await opendir(ioPath(folder))) {
    assert.ok(names.length<cap, 'Directory count bound.'); names.push(entry.name);
  }
  return names.sort();
}
function member(value) {
  assert.ok(typeof value==='string' && Buffer.byteLength(value)<=treeCaps.pathBytes && value.length>0 &&
    value.split('/').every(part=>part && part!=='.' && part!=='..' && !/[\\:\0]/.test(part)));
}
export async function inventory(fixedRoot) {
  const files=[],directories=[]; let bytes=0;
  async function visit(folder,relative,depth) {
    assert.ok(depth<=treeCaps.depth && directories.length<treeCaps.directories);
    const before=await ordinary(folder,true); directories.push(relative);
    const names=await boundedNames(folder);
    for (const name of names) {
      const key=relative==='.'?name:`${relative}/${name}`; member(key);
      const file=path.join(folder,name), info=await lstat(ioPath(file),{bigint:true});
      if (info.isDirectory()) await visit(file,key,depth+1);
      else {
        assert.ok(files.length<treeCaps.files);
        const item=await fixedRegularDigest(file,Math.min(treeCaps.fileBytes,treeCaps.totalBytes-bytes));
        assert.ok(same(info,await ordinary(file)), 'Inventory snapshot changed.');
        bytes+=item.bytes; assert.ok(bytes<=treeCaps.totalBytes); files.push({path:key,...item});
      }
    }
    assert.deepEqual(await boundedNames(folder),names);
    assert.ok(same(before,await ordinary(folder,true)), 'Directory changed while read.');
  }
  await visit(fixedRoot,'.',0);
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0); directories.sort();
  return {files,directories,total_bytes:bytes};
}
const framed = tree => hash(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(tree).filter(([key])=>key!=='framed_sha256')))));
export function validateTree(tree, root) {
  exact(tree,['schema_version','root','caps','files','directories','total_bytes','framed_sha256']);
  assert.equal(tree.schema_version,'fixed-packaged-desktop-tree-v1'); assert.equal(tree.root,root);
  assert.deepEqual(tree.caps,treeCaps); assert.equal(tree.framed_sha256,framed(tree));
  assert.ok(Array.isArray(tree.files) && tree.files.length<=treeCaps.files && Array.isArray(tree.directories) && tree.directories.length<=treeCaps.directories);
  const names=[]; let bytes=0;
  for (const item of tree.files) {
    exact(item,['path','bytes','sha256']); member(item.path); assert.match(item.sha256,shaPattern);
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes>=0 && item.bytes<=treeCaps.fileBytes);
    bytes+=item.bytes; names.push(item.path);
  }
  assert.deepEqual(names,[...new Set(names)].sort());
  assert.ok(tree.directories.includes('.'));
  for (const name of tree.directories) { if (name!=='.') member(name); assert.ok(!names.includes(name)); }
  assert.deepEqual(tree.directories,[...new Set(tree.directories)].sort());
  assert.ok(Number.isSafeInteger(tree.total_bytes) && tree.total_bytes===bytes && bytes<=treeCaps.totalBytes);
  return tree;
}
export function compareTrees(original, before, after) {
  for (const tree of [original,before,after]) validateTree(tree,original.root);
  for (const tree of [before,after]) {
    assert.deepEqual(tree.files,original.files); assert.equal(tree.total_bytes,original.total_bytes);
    assert.ok(original.directories.every(name=>tree.directories.includes(name)));
    assert.ok(tree.directories.filter(name=>!original.directories.includes(name)).every(name=>emptyGpuDirectories.includes(name)));
    assert.ok(tree.files.every(row=>row.path.toLowerCase()!==emptyGpuDirectories[0].toLowerCase() && !row.path.toLowerCase().startsWith(emptyGpuDirectories[0].toLowerCase()+'/')));
  }
  assert.ok(before.directories.every(name=>after.directories.includes(name)));
  return {before_framed_sha256:original.framed_sha256, after_framed_sha256:after.framed_sha256,
    added_empty_directories:after.directories.filter(name=>!original.directories.includes(name)), all_files_unchanged:true, all_original_directories_preserved:true};
}

function validateContext(value) {
  exact(value,['schema_version','originalRoot','candidate','run','sourceRevision','python','launcher','configFile','runtimePins','chrome','chromePin','zip','zipPin','ocrSourceSha256']);
  assert.equal(value.schema_version,'fixed-provided-host-context-v1');
  for (const key of ['originalRoot','candidate','run','python','launcher','configFile','chrome','zip']) ioPath(value[key]);
  assert.match(path.relative(value.originalRoot,value.candidate).split(path.sep).join('/'),/^\.local-codex\/q\/[a-f0-9]{8}\/c$/);
  assert.match(path.relative(path.join(value.candidate,'.local-codex/native-fixed-host-operator/runs'),value.run),/^[a-f0-9]{32}$/);
  assert.match(value.sourceRevision,/^source\.[a-f0-9]{64}$/); assert.match(value.ocrSourceSha256,shaPattern);
  assert.equal(path.basename(value.python).toLowerCase(),'python.exe');
  assert.equal(value.launcher,path.join(value.originalRoot,'.local-codex/ocr-cached-runtime-v1/venv/Scripts/python.exe'));
  assert.equal(value.configFile,path.join(value.originalRoot,'.local-codex/ocr-cached-runtime-v1/venv/pyvenv.cfg'));
  assert.equal(path.basename(value.chrome).toLowerCase(),'chrome.exe');
  assert.match(path.relative(value.originalRoot,value.zip).split(path.sep).join('/'),/^\.local-codex\/electron-official-cache\/[a-f0-9]{64}\/electron-v[0-9]+\.[0-9]+\.[0-9]+-win32-x64\.zip$/);
  const expected=[value.python,path.join(path.dirname(value.python),'python312.dll'),value.launcher,value.configFile];
  assert.ok(Array.isArray(value.runtimePins) && value.runtimePins.length===expected.length);
  for (const pin of value.runtimePins) { exact(pin,['path','cap','bytes','sha256']); assert.ok(expected.includes(pin.path)); assert.match(pin.sha256,shaPattern); assert.ok(Number.isSafeInteger(pin.cap) && pin.cap>0 && pin.cap<=128*1024**2 && Number.isSafeInteger(pin.bytes) && pin.bytes>0 && pin.bytes<=pin.cap); }
  assert.equal(new Set(value.runtimePins.map(pin=>pin.path)).size,expected.length);
  for (const pin of [value.chromePin,value.zipPin]) { exact(pin,['bytes','sha256']); assert.match(pin.sha256,shaPattern); assert.ok(Number.isSafeInteger(pin.bytes) && pin.bytes>0 && pin.bytes<=treeCaps.fileBytes); }
  assert.ok(value.chromePin.bytes<=16*1024**2);
  for (const pin of value.runtimePins) Object.freeze(pin);
  Object.freeze(value.runtimePins); Object.freeze(value.chromePin); Object.freeze(value.zipPin);
  Object.freeze(value);
  return value;
}
export function getFixedContext() {
  assert.ok(FIXED_CONTEXT!==null, 'A compiled reviewed context is required.');
  const value=validateContext(FIXED_CONTEXT);
  assert.equal(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),value.candidate);
  return value;
}
export function getPackageRoot() { return path.join(getFixedContext().candidate,'out/ai-system-builder-win32-x64'); }
export async function assertFixedEnvironment() {
  const ctx=getFixedContext(); assert.equal(process.cwd(),ctx.candidate);
  assert.equal(process.env.AISB_LOCAL_DESKTOP_UI_RUN,ctx.run); assert.equal(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO,'dataset-profile');
  for (const key of ['PYTHON','PYTHON_RUNTIME_COMMAND']) assert.equal(process.env[key],ctx.python);
  assert.equal(process.env.__PYVENV_LAUNCHER__,ctx.launcher); assert.equal(process.env.PYTHONNOUSERSITE,'1'); assert.equal(process.env.NODE_OPTIONS,'');
  for (const key of ['PIP_NO_INDEX','HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD']) assert.equal(process.env[key],'1');
  for (const pin of ctx.runtimePins) assert.deepEqual(await fixedRegularDigest(pin.path,pin.cap),{bytes:pin.bytes,sha256:pin.sha256});
  return ctx;
}
export async function readFixedPackageTree() {
  const root=getPackageRoot(), tree={schema_version:'fixed-packaged-desktop-tree-v1',root,caps:treeCaps,...await inventory(root)};
  assert.ok(tree.files.length>0); return {...tree,framed_sha256:framed(tree)};
}
export async function verifyFixedOcrWorkerResources() {
  const ctx=getFixedContext(), selectedRoot=path.join(ctx.candidate,'modules/adapters/runtime/python/worker'), deployedRoot=path.join(getPackageRoot(),'resources/worker');
  const a=await inventory(selectedRoot), b=await inventory(deployedRoot);
  const selected={files:a.files,total_bytes:a.total_bytes}, deployed={files:b.files,total_bytes:b.total_bytes};
  assert.ok(selected.files.length>0); assert.deepEqual(deployed,selected);
  const source=await boundedRead(path.join(deployedRoot,'ocr/native/WindowsOcrHelper.cs'),1024**2,ctx.ocrSourceSha256);
  const manifestRaw=await boundedRead(path.join(deployedRoot,'ocr/native/build/resource.json'),4096);
  const binary=await boundedRead(path.join(deployedRoot,'ocr/native/build/WindowsOcrHelper.exe'),2*1024**2);
  const manifest=parseStrictJson(manifestRaw,4096);
  assert.deepEqual(manifest,{schema_version:'windows-ocr-resource-v1',provider:'windows',provider_version:'1',architecture:'x64',source_sha256:hash(source),binary_sha256:hash(binary),binary_bytes:binary.length});
  assert.ok(binary.length>=256); assert.equal(binary.subarray(0,2).toString('ascii'),'MZ');
  const pe=binary.readUInt32LE(0x3c); assert.ok(pe>=64 && pe<=Math.min(4096,binary.length-24));
  assert.equal(binary.readUInt32LE(pe),0x4550); assert.equal(binary.readUInt16LE(pe+4),0x8664); assert.equal(binary.readUInt16LE(pe+22)&0x2000,0);
  return {schema_version:'fixed-deployed-ocr-worker-identity-v1',selected_root:selectedRoot,deployed_root:deployedRoot,...selected,
    framed_sha256:hash(Buffer.from(JSON.stringify(selected))),all_worker_files_raw_exact:true,helper_source_sha256:hash(source),
    helper_manifest_sha256:hash(manifestRaw),helper_binary_sha256:hash(binary),helper_binary_bytes:binary.length,
    optional_build_success_inferred_from_package_exit:false,resource_runtime_or_UI_qualified:false};
}
