import assert from "node:assert/strict";
import { before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWindowsModelFileIdentityAdapter } from "../createWindowsModelFileIdentityAdapter";
import { parseWindowsIdentityOpen, type WindowsFileIdentityFacts } from "../windowsModelFileIdentityProtocol";

const supported = process.platform === "win32" && process.arch === "x64";
let executablePath: string; let binarySha256: string;
before(async () => {
  if (!supported) return;
  assert.ok(process.env.PYTHON, "Select the repository qualification Python explicitly.");
  const build = spawnSync(process.env.PYTHON!, ["-B", "dev-tools/scripts/native/build_windows_model_file_identity.py"], { encoding: "utf8", timeout: 240_000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.equal(build.error, undefined); assert.equal(build.status, 0, "Fixed installed native profile must build successfully.");
  const result = JSON.parse(build.stdout.trim().split(/\r?\n/).at(-1)!);
  assert.equal(result.physical_exit_code, 0); assert.equal(result.cleanup_passed, true);
  assert.match(result.build, /^artifacts\/tmp\/native-model-identity\/[a-f0-9]{32}$/);
  executablePath = path.resolve(result.build, "model_file_identity.exe"); binarySha256 = result.binary_sha256;
  const manifest = JSON.parse(await readFile(path.resolve(result.build,"manifest.json"),"utf8"));
  assert.equal(manifest.binary_sha256,binarySha256); assert.equal(manifest.compiler_exit_code,0);
  assert.equal(manifest.source_sha256,createHash("sha256").update(await readFile(manifest.source)).digest("hex"));
  assert.equal(createHash("sha256").update(await readFile(executablePath)).digest("hex"),binarySha256);
  assert.equal(manifest.compiler_job.enforced,true); assert.equal(manifest.compiler_job.active_processes,1);
  console.log(JSON.stringify({native_fixture_build:result.build,binary_sha256:binarySha256,build_native_exit:result.physical_exit_code}));
});

async function fixture(run: (root: string) => Promise<void>) {
  const boundary=await realpath(path.resolve(".local-codex/t")); const root=await mkdtemp(path.join(boundary,"native-identity-fixture-")); const initial=await lstat(root,{bigint:true});
  try { await run(root); }
  finally {
    // The callback must await native close before returning. Never clean an
    // adopted location, symlink root or a substituted fixture identity.
    assert.equal(await realpath(root),root); assert.equal(path.dirname(root),boundary);
    const current=await lstat(root,{bigint:true});assert.equal(current.isSymbolicLink(),false); assert.equal(current.dev,initial.dev); assert.equal(current.ino,initial.ino);
    await rm(root,{recursive:true});
  }
}
function raw(input:string) {
  const result=spawnSync(executablePath,[],{input,encoding:"utf8",timeout:5000,maxBuffer:16384,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR}});
  assert.equal(result.error,undefined); assert.equal(result.signal,null); assert.equal(result.stderr,"");
  const lines=result.stdout.trim().split("\n"); assert.equal(lines.shift(),`aisb-file-id-v1\t${result.pid}`);
  return {status:result.status,lines};
}
const probeRoot=(root:string)=>`ROOT\t${Buffer.from(root,"utf16le").toString("hex")}\tprobe\tprobe\n`;
function discover(root:string, children:readonly {parent:number;name:string;kind:"D"|"F"}[]=[]):WindowsFileIdentityFacts[] {
  const result=raw(probeRoot(root)+children.map(child=>`CHILD\t${child.parent}\t${child.name}\t${child.kind}\tprobe\tprobe\n`).join("")+"RELEASE\n");
  assert.equal(result.status,0);assert.equal(result.lines.pop(),"released"); return result.lines.map(parseWindowsIdentityOpen);
}
const adapter=()=>createWindowsModelFileIdentityAdapter({executablePath,binarySha256});
const unavailable={code:"unavailable"};

test("actual NTFS relative handles pin identity, deny writers/rename and release normally",{skip:!supported},async()=>fixture(async root=>{
  await mkdir(path.join(root,"model"));const file=path.join(root,"model","weights.bin");await writeFile(file,"sentinel",{flag:"wx"});
  const ids=discover(root,[{parent:0,name:"model",kind:"D"},{parent:1,name:"weights.bin",kind:"F"}]);const lease=await adapter().acquire(root,ids[0]!);
  await lease.inspectChild(0,"model","D",ids[1]!);await lease.inspectChild(1,"weights.bin","F",ids[2]!);
  try { await assert.rejects(async()=>{const unexpected=await open(file,"r+");await unexpected.close();}); await assert.rejects(rename(path.join(root,"model"),path.join(root,"moved"))); }
  finally { await lease.release(); }
  const writer=await open(file,"r+");await writer.close();await rename(path.join(root,"model"),path.join(root,"moved"));assert.equal(await readFile(path.join(root,"moved","weights.bin"),"utf8"),"sentinel");
}));
test("actual root and child identity substitution and preexisting writers deny",{skip:!supported},async()=>fixture(async root=>{
  await mkdir(path.join(root,"model"));const file=path.join(root,"model","weights.bin");await writeFile(file,"original");
  const ids=discover(root,[{parent:0,name:"model",kind:"D"},{parent:1,name:"weights.bin",kind:"F"}]);
  await assert.rejects(adapter().acquire(root,{...ids[0]!,fileId:ids[0]!.fileId[0]==="f"?"e".repeat(32):"f".repeat(32)}),unavailable);
  await rename(file,path.join(root,"model","original.bin"));await writeFile(file,"replacement");
  let lease=await adapter().acquire(root,ids[0]!);await lease.inspectChild(0,"model","D",ids[1]!);await assert.rejects(lease.inspectChild(1,"weights.bin","F",ids[2]!),unavailable);
  const newer=discover(root,[{parent:0,name:"model",kind:"D"},{parent:1,name:"weights.bin",kind:"F"}]);const writer=await open(file,"r+");
  try { lease=await adapter().acquire(root,newer[0]!);await lease.inspectChild(0,"model","D",newer[1]!);await assert.rejects(lease.inspectChild(1,"weights.bin","F",newer[2]!),unavailable); }
  finally {await writer.close();}
  await rename(path.join(root,"model"),path.join(root,"old-model"));await mkdir(path.join(root,"model"));
  lease=await adapter().acquire(root,ids[0]!);await assert.rejects(lease.inspectChild(0,"model","D",ids[1]!),unavailable);
  assert.equal(await readFile(path.join(root,"old-model","original.bin"),"utf8"),"original");assert.equal(await readFile(path.join(root,"old-model","weights.bin"),"utf8"),"replacement");
}));
test("actual junction roots, junction ancestors/children and multiply linked files deny",{skip:!supported},async()=>fixture(async root=>{
  const target=path.join(root,"target");await mkdir(target);await mkdir(path.join(target,"nested"));await writeFile(path.join(target,"weights.bin"),"sentinel");const ids=discover(root);
  const junction=path.join(root,"junction");await symlink(target,junction,"junction");
  try {
    for(const location of [junction,path.join(junction,"nested")]) {const result=raw(probeRoot(location)+"RELEASE\n");assert.equal(result.status,2);assert.equal(result.lines.at(-1),"unavailable");}
    const lease=await adapter().acquire(root,ids[0]!);await assert.rejects(lease.inspectChild(0,"junction","D",ids[0]!),unavailable);
  } finally { await unlink(junction); }
  const file=path.join(target,"weights.bin");const alias=path.join(root,"alias.bin");await link(file,alias);
  try {const result=raw(probeRoot(root)+"CHILD\t0\talias.bin\tF\tprobe\tprobe\nRELEASE\n");assert.equal(result.status,2);assert.equal(result.lines.at(-1),"unavailable");}
  finally {await unlink(alias);}
  assert.equal(await readFile(file,"utf8"),"sentinel");
}));
test("actual malformed/oversized private frames deny with finite non-disclosing native exit",{skip:!supported},async()=>fixture(async root=>{
  for(const input of ["secret-invalid-request\n", "x".repeat(131201)+"\n", probeRoot(root)+"CHILD\t0\t..\tD\tprobe\tprobe\n",probeRoot(root)+"CHILD\t0\tfile:secret\tF\tprobe\tprobe\n"]) {
    const result=raw(input);assert.equal(result.status,2);assert.equal(result.lines.at(-1),"unavailable");assert.ok(!result.lines.join("").includes("secret"));
  }
}));
test("actual native handle table admits its finite boundary and denies an additional object",{skip:!supported},async()=>fixture(async root=>{
  for(let i=0;i<64;i++)await writeFile(path.join(root,`file-${i}.bin`),"bounded");
  const requests=Array.from({length:64},(_,i)=>`CHILD\t0\tfile-${i}.bin\tF\tprobe\tprobe\n`);
  const admitted=raw(probeRoot(root)+requests.slice(0,63).join("")+"RELEASE\n");assert.equal(admitted.status,0);assert.equal(admitted.lines.pop(),"released");assert.equal(admitted.lines.length,64);
  const denied=raw(probeRoot(root)+requests.join("")+"RELEASE\n");assert.equal(denied.status,2);assert.equal(denied.lines.at(-1),"unavailable");
}));
test("actual replaced root parent denies and held ancestor cannot be renamed",{skip:!supported},async()=>fixture(async root=>{
  const parent=path.join(root,"parent");const leaf=path.join(parent,"leaf");await mkdir(leaf,{recursive:true});await writeFile(path.join(leaf,"sentinel.bin"),"original");const old=discover(leaf);
  await rename(parent,path.join(root,"old-parent"));await mkdir(leaf,{recursive:true});await writeFile(path.join(leaf,"sentinel.bin"),"replacement");
  await assert.rejects(adapter().acquire(leaf,old[0]!),unavailable);
  const current=discover(leaf);const lease=await adapter().acquire(leaf,current[0]!);
  try {await assert.rejects(rename(parent,path.join(root,"moved-parent")));}finally{await lease.release();}
  await rename(parent,path.join(root,"moved-parent"));assert.equal(await readFile(path.join(root,"old-parent","leaf","sentinel.bin"),"utf8"),"original");assert.equal(await readFile(path.join(root,"moved-parent","leaf","sentinel.bin"),"utf8"),"replacement");
}));
test("actual builder rejects redirected ancestor before creating an absent output namespace",{skip:!supported},async()=>fixture(async root=>{
  const project=path.join(root,"builder-project");const target=path.join(root,"redirect-target");await mkdir(path.join(project,"artifacts"),{recursive:true});await mkdir(target);
  const junction=path.join(project,"artifacts","tmp");await symlink(target,junction,"junction");
  try {
    // Only this test import replaces private constants, exclusively with newly
    // created fixture roots. The production CLI has no output-path override.
    const script=`import importlib.util,json,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location("builder_fixture",sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)\nmodule.ROOT=Path(sys.argv[2]);module.NAMESPACE=module.ROOT/"artifacts/tmp/native-model-identity"\ntry:\n module.create_output_folder()\nexcept ValueError:\n assert not (Path(sys.argv[3])/"native-model-identity").exists()\n print(json.dumps({"denied":True,"target_unchanged":True}))\nelse:\n raise AssertionError("Redirected builder ancestor admitted")\n`;
    const result=spawnSync(process.env.PYTHON!,["-B","-c",script,path.resolve("dev-tools/scripts/native/build_windows_model_file_identity.py"),project,target],{encoding:"utf8",timeout:15000,maxBuffer:16384,windowsHide:true});
    assert.equal(result.error,undefined);assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{denied:true,target_unchanged:true});
  } finally {await unlink(junction);}
}));
test("actual lease deadline closes the exact native process and releases its handles",{skip:!supported,timeout:15000},async()=>fixture(async root=>{
  const ids=discover(root);const lease=await adapter().acquire(root,ids[0]!);
  await new Promise(resolve=>setTimeout(resolve,10_300));await assert.rejects(lease.release(),unavailable);
  const next=await adapter().acquire(root,ids[0]!);await next.release();
}));
test("actual read-only directory identity lease is not a fence against new child bytes",{skip:!supported},async()=>fixture(async root=>{
  const ids=discover(root);const lease=await adapter().acquire(root,ids[0]!);
  const added=path.join(root,"new-child.bin");
  try {await writeFile(added,"new allocation",{flag:"wx"});assert.equal(await readFile(added,"utf8"),"new allocation");}
  finally {await lease.release();}
  // Successful identity revalidation does not prove stable membership/bytes.
  assert.ok((await lstat(added)).size>0);
}));
