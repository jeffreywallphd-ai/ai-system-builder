// Definition only until exact metadata and Native effects are separately reviewed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';

export const VERSION='42.11.18';
export const CONFIG='apps/desktop/forge.config.js';
export const WORKER='modules/adapters/runtime/python/worker/main.py';
export const CONFIG_TRAILER=`
// Closed offline qualification paths. Original hooks and plugin configuration stay intact.
const aisbQualificationCandidate = path.resolve(__dirname, "../..");
if (process.platform !== "win32" || process.cwd() !== aisbQualificationCandidate ||
    !/[/\\\\]\\.local-codex[/\\\\]q[/\\\\][a-f0-9]{8}[/\\\\]c$/.test(aisbQualificationCandidate)) {
  throw new Error("The fixed offline package candidate is unavailable.");
}
module.exports.packagerConfig = {
  ...module.exports.packagerConfig,
  electronZipDir: path.resolve(aisbQualificationCandidate, "../z"),
  tmpdir: path.resolve(aisbQualificationCandidate, "../pt"),
  overwrite: false,
};
`;
const need=(v)=>{if(!v)throw new Error('The fixed offline package evidence is unavailable.');};
export const sha=b=>createHash('sha256').update(b).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!types.isProxy(v)&&
  !Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const dataEntries=(v)=>{need(plain(v));const keys=Reflect.ownKeys(v);need(keys.every(k=>typeof k==='string'));
  const descriptors=Object.getOwnPropertyDescriptors(v);need(keys.every(k=>Object.hasOwn(descriptors[k],'value')&&descriptors[k].enumerable));
  return keys.map(k=>[k,descriptors[k].value]);};
const exact=(v,keys)=>{const names=dataEntries(v).map(([k])=>k);need(names.length===keys.length&&names.every(k=>keys.includes(k)));};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

export function relativeName(value) {
  need(typeof value==='string'&&value.length>0&&value.length<=400&&/^[\x20-\x7e]+$/.test(value)&&
    !/[\\:*?"<>|]/.test(value)&&!path.posix.isAbsolute(value)&&path.posix.normalize(value)===value);
  const parts=value.split('/');
  need(parts.every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)));
  return value;
}
export function fixedPaths(root,runId) {
  need(typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&typeof runId==='string'&&/^[a-f0-9]{32}$/.test(runId));
  const run=path.join(root,'.local-codex/native-training-host-v1/runs',runId);
  const short=path.join(root,'.local-codex/q',runId.slice(0,8));
  return Object.freeze({root,run,short,phase:path.join(run,'training-package'),candidate:path.join(short,'c'),
    output:path.join(short,'o'),packageRoot:path.join(short,'o/ai-system-builder-win32-x64'),
    zipDirectory:path.join(short,'z'),zip:path.join(short,'z',`electron-v${VERSION}-win32-x64.zip`),
    packageTemp:path.join(short,'pt')});
}
export function assertPaths(paths) {
  exact(paths,['root','run','short','phase','candidate','output','packageRoot','zipDirectory','zip','packageTemp']);
  need(typeof paths.root==='string'&&typeof paths.run==='string');
  const expected=fixedPaths(paths.root,path.basename(paths.run));exact(paths,Object.keys(expected));
  need(Object.keys(expected).every(k=>paths[k]===expected[k]));
}
export function manifestRows(document,family) {
  need(family==='source'||family==='electron');
  if(family==='source') {
    exact(document,['schema_version','source_commit','source_digest','files','file_count','total_bytes','candidate_not_created']);
    need(document.schema_version==='training-source-copy-references-v1'&&typeof document.source_commit==='string'&&/^[a-f0-9]{40}$/.test(document.source_commit)&&
      hex(document.source_digest)&&document.candidate_not_created===true);
  } else {
    exact(document,['schema_version','version','platform','arch','distribution_relative','files','file_count','total_bytes','source_only_reference','new_zip_not_created']);
    need(document.schema_version==='installed-electron-distribution-references-v1'&&document.version===VERSION&&
      document.platform==='win32'&&document.arch==='x64'&&document.distribution_relative==='node_modules/electron/dist'&&
      document.source_only_reference===true&&document.new_zip_not_created===true);
  }
  const rows=dataEntries(document.files),seen=new Set();let total=0;
  need(rows.length>0&&rows.length<=(family==='source'?4096:512)&&document.file_count===rows.length);
  for(const [name,row] of rows) {
    relativeName(name);need(!seen.has(name.toLowerCase()));seen.add(name.toLowerCase());
    if(family==='source')need(!name.split('/').some(p=>['.git','.local-codex','node_modules','__pycache__'].includes(p)));
    exact(row,['bytes','sha256']);need(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&
      row.bytes<=(family==='source'?8:256)*1024**2&&hex(row.sha256));total+=row.bytes;
  }
  need(total===document.total_bytes&&total<=(family==='source'?128*1024**2:1024**3));
  const required=family==='source'?['package.json','package-lock.json',CONFIG,WORKER,
    'apps/desktop/vite.main.config.mjs','apps/desktop/vite.preload.config.mjs',
    'apps/desktop/vite.renderer.config.mjs','apps/desktop/vite.runtime.config.mjs',
    'apps/desktop/vite.renderer.shared.mjs','dev-tools/scripts/native/build_windows_ocr.cjs','dev-tools/scripts/native/build_windows_ocr.py']:
    ['electron.exe','version','LICENSE','resources/default_app.asar'];
  need(required.every(n=>Object.hasOwn(document.files,n)));return rows;
}
export function regularDirectory(directory) {
  need(typeof directory==='string'&&path.isAbsolute(directory)&&path.resolve(directory)===directory);
  const s=fs.lstatSync(directory);need(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(directory)===directory);
  const parent=path.dirname(directory);if(parent!==directory)regularDirectory(parent);
}
export function fileFacts(filename,maximum,{singleLink=false,retain=false}={}) {
  need(Number.isSafeInteger(maximum)&&maximum>=0&&(!retain||maximum<=1024**2));
  regularDirectory(path.dirname(filename));need(path.resolve(filename)===filename);
  const before=fs.lstatSync(filename,{bigint:true});
  const valid=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink>=1n&&(!singleLink||s.nlink===1n)&&s.size>=0n&&s.size<=BigInt(maximum);
  const key=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.nlink].map(String).join('|');need(valid(before));
  const fd=fs.openSync(filename,'r');let count=0;const hash=createHash('sha256'),chunks=[];
  try {
    const opened=fs.fstatSync(fd,{bigint:true});need(valid(opened)&&key(opened)===key(before));
    const buffer=Buffer.alloc(65536);
    while(true){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,maximum+1-count),null);if(!n)break;
      count+=n;need(count<=maximum);hash.update(buffer.subarray(0,n));if(retain)chunks.push(Buffer.from(buffer.subarray(0,n)));}
    const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(filename,{bigint:true});
    need(valid(after)&&valid(named)&&key(opened)===key(after)&&key(after)===key(named)&&
      before.ctimeNs===named.ctimeNs&&opened.ctimeNs===after.ctimeNs&&BigInt(count)===opened.size);
  } finally {fs.closeSync(fd);}
  return {bytes:count,sha256:hash.digest('hex'),...(retain?{raw:Buffer.concat(chunks,count)}:{})};
}
export function verifiedFile(filename,expected,maximum,options={}) {
  exact(expected,['bytes','sha256']);need(Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&hex(expected.sha256));
  const actual=fileFacts(filename,maximum,options);need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256);return actual;
}
export function readJson(filename,expectedHash,maximum=1024**2) {
  need(hex(expectedHash));const facts=fileFacts(filename,maximum,{retain:true});need(facts.sha256===expectedHash);
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(facts.raw));
}
export function walk(root,maximumFiles=4096,maximumBytes=1024**3) {
  regularDirectory(root);const files=Object.create(null),directories=[],pending=[root];let total=0,nodes=0;
  while(pending.length) {
    const parent=pending.pop();regularDirectory(parent);
    for(const entry of fs.readdirSync(parent,{withFileTypes:true})) {
      need(++nodes<=8192);const target=path.join(parent,entry.name),name=relativeName(path.relative(root,target).split(path.sep).join('/'));
      need(!entry.isSymbolicLink());
      if(entry.isDirectory()){regularDirectory(target);directories.push(name);pending.push(target);}
      else {need(entry.isFile());const facts=fileFacts(target,256*1024**2,{singleLink:true});
        files[name]=facts;total+=facts.bytes;need(Object.keys(files).length<=maximumFiles&&total<=maximumBytes);}
    }
  }
  need(new Set(Object.keys(files).map(n=>n.toLowerCase())).size===Object.keys(files).length);
  return {files,directories:directories.sort(),file_count:Object.keys(files).length,total_bytes:total};
}
export function transformedConfig(source) {return Buffer.concat([source,Buffer.from(CONFIG_TRAILER)]);}
export function verifyCopiedSources(paths,source,{beforePackage=false}={}) {
  assertPaths(paths);
  const rows=manifestRows(source,'source');
  for(const [name,row] of rows) {
    verifiedFile(path.join(paths.root,name),row,8*1024**2);
    let expected=row;
    if(name===CONFIG){const original=fileFacts(path.join(paths.root,name),65536,{retain:true}).raw;need(sha(original)===row.sha256);
      const value=transformedConfig(original);expected={bytes:value.length,sha256:sha(value)};}
    verifiedFile(path.join(paths.candidate,name),expected,8*1024**2,{singleLink:true});
  }
  if(beforePackage) {
    regularDirectory(path.join(paths.candidate,'node_modules'));need(fs.readdirSync(path.join(paths.candidate,'node_modules')).length===0);
    const actual=walk(paths.candidate,4096,128*1024**2);
    need(Object.keys(actual.files).sort().join('|')===rows.map(([n])=>n).sort().join('|'));
    const expected=new Set(['node_modules']);
    for(const [name]of rows){let parent=path.posix.dirname(name);while(parent!=='.'){expected.add(parent);parent=path.posix.dirname(parent);}}
    need(actual.directories.join('|')===[...expected].sort().join('|'));
    need(!fs.existsSync(paths.output));regularDirectory(paths.packageTemp);need(fs.readdirSync(paths.packageTemp).length===0);
  }
}
export function fixedForgeOptions(paths) {
  assertPaths(paths);
  return {dir:paths.candidate,outDir:paths.output,platform:'win32',arch:'x64',interactive:false};
}
export function assertTargets(targets,paths) {
  assertPaths(paths);need(!types.isProxy(targets)&&Array.isArray(targets)&&targets.length===1);
  need(Reflect.ownKeys(targets).length===2&&Reflect.ownKeys(targets).every(k=>k==='0'||k==='length'));
  need(Object.hasOwn(Object.getOwnPropertyDescriptor(targets,'0')??{},'value'));exact(targets[0],['platform','arch','packagedPath']);
  need(targets[0].platform==='win32'&&targets[0].arch==='x64'&&targets[0].packagedPath===paths.packageRoot);
}
export function packageTree(paths,source) {
  assertPaths(paths);manifestRows(source,'source');
  const tree=walk(paths.packageRoot);const files=tree.files;
  const required=['ai-system-builder.exe','resources/app/package.json','resources/app/.vite/build/main.cjs',
    'resources/app/.vite/build/main_window_preload.cjs','resources/app/.vite/build/system_runtime_preload.cjs',
    'resources/app/.vite/renderer/main_window/index.html','resources/app/.vite/renderer/system_runtime/index.html','resources/worker/main.py'];
  need(required.every(n=>files[n]?.bytes>0));need(files['ai-system-builder.exe'].bytes>=1024**2);
  const fd=fs.openSync(path.join(paths.packageRoot,'ai-system-builder.exe'),'r');try{const b=Buffer.alloc(2);need(fs.readSync(fd,b,0,2,0)===2&&b.toString('ascii')==='MZ');}finally{fs.closeSync(fd);}
  need(files['resources/worker/main.py'].sha256===source.files[WORKER].sha256);
  const workerPrefix='modules/adapters/runtime/python/worker/';
  const workerRows=Object.entries(source.files).filter(([name])=>name.startsWith(workerPrefix));need(workerRows.length>0);
  for(const [name,expected]of workerRows) {
    const target='resources/worker/'+name.slice(workerPrefix.length);
    need(Object.hasOwn(files,target)&&files[target].bytes===expected.bytes&&files[target].sha256===expected.sha256);
  }
  const pkg=readJson(path.join(paths.packageRoot,'resources/app/package.json'),files['resources/app/package.json'].sha256,65536);
  need(pkg.name==='ai-system-builder'&&pkg.version==='0.1.0'&&pkg.main==='.vite/build/main.cjs');
  return {...tree,application_sha256:files['ai-system-builder.exe'].sha256,worker_main_sha256:files['resources/worker/main.py'].sha256,
    worker_source_files:workerRows.length,
    optional_ocr_build_files:Object.keys(files).filter(n=>n.startsWith('resources/worker/ocr/native/build/')).length,
    optional_ocr_qualification:'not-asserted'};
}
export function writeExclusiveJson(filename,value,maximum=1024**2) {
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');need(raw.length<=maximum);const fd=fs.openSync(filename,'wx',0o600);
  try{need(fs.writeSync(fd,raw)===raw.length);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {bytes:raw.length,sha256:sha(raw)};
}
