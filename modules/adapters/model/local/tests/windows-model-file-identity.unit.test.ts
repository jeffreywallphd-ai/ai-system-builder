import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWindowsModelFileIdentityAdapter } from "../createWindowsModelFileIdentityAdapter";
import { encodeWindowsIdentityChild, encodeWindowsIdentityRoot, parseWindowsIdentityOpen } from "../windowsModelFileIdentityProtocol";

const identity = { volume: "1".repeat(16), fileId: "2".repeat(32) };
const frame = (index = 0, kind = "D", id = identity.fileId) => `OPEN\t${index}\t${identity.volume}\t${id}\t${kind}\t1\t1\t1\t0\t4`;
test("private protocol preserves full identities and freezes facts without granting ownership", () => {
  const facts = parseWindowsIdentityOpen(frame()); assert.equal(facts.fileId, identity.fileId); assert.equal(facts.currentOwner, true); assert.equal(facts.daclProtected, false); assert.ok(Object.isFrozen(facts));
  assert.match(encodeWindowsIdentityRoot("C:\\owned\\root", identity), /^ROOT\t[0-9a-f]+\t/);
  assert.equal(encodeWindowsIdentityChild(0, "model.safetensors", "F", identity), `CHILD\t0\tmodel.safetensors\tF\t${identity.volume}\t${identity.fileId}\n`);
});
test("protocol denies malformed, unknown, multilink, noncanonical and oversized facts", () => {
  for (const line of [frame().replace(identity.fileId, "0".repeat(32)), frame().replace(identity.volume, "probe"), frame(64), frame(0, "Q"), frame(0,"F").replace("\tF\t1\t", "\tF\t2\t"), frame().replace("\t0\t", "\t00\t"), frame()+"\textra", "x".repeat(257), frame().replace("\t1\t1\t0\t4", "\t1\t0\t0\t4")]) assert.throws(() => parseWindowsIdentityOpen(line), { code: "unavailable" });
});
test("private root and child frames reject namespace, traversal, ADS, reserved and limit violations", () => {
  for (const root of ["relative", "\\\\server\\share", "\\\\?\\C:\\owned", "C:\\root\\..\\other", "C:\\root\\part.", "C:\\root:ads", "C:\\root\nsecret", "C:\\"+"a".repeat(256), "C:\\"+Array(129).fill("part").join("\\")]) assert.throws(() => encodeWindowsIdentityRoot(root, identity), { code: "unavailable" });
  for (const name of ["", ".", "..", "child/other", "child\\other", "stream:ads", "NUL.txt", "COM1", "lpt9.log", "name.", "name ", "a".repeat(256), "\nsecret"]) assert.throws(() => encodeWindowsIdentityChild(0, name, "F", identity), { code: "unavailable" });
  for (const parent of [-1,64,1.5,NaN]) assert.throws(() => encodeWindowsIdentityChild(parent,"ok","F",identity), {code:"unavailable"});
  assert.doesNotThrow(() => encodeWindowsIdentityChild(63,"a".repeat(255),"F",identity));
});

const roots: { root: string; dev: bigint; ino: bigint; boundary: string }[] = [];
afterEach(async () => {
  mock.restoreAll(); syncBuiltinESMExports();
  for (const entry of roots.splice(0)) {
    const absolute = await realpath(entry.root); const current = await lstat(entry.root, { bigint: true });
    assert.equal(absolute,entry.root); assert.equal(path.dirname(absolute),entry.boundary); assert.equal(current.dev,entry.dev); assert.equal(current.ino,entry.ino);
    await rm(absolute,{recursive:true});
  }
});
async function executable() {
  const boundary=await realpath(path.resolve(".local-codex/t"));const root=await mkdtemp(path.join(boundary,"native-protocol-unit-"));const stat=await lstat(root,{bigint:true});roots.push({root,dev:stat.dev,ino:stat.ino,boundary});
  const file=path.join(root,"synthetic.exe");const bytes=Buffer.from("inert fixture, never executable");await writeFile(file,bytes,{flag:"wx"});
  return {executablePath:file,binarySha256:createHash("sha256").update(bytes).digest("hex")};
}
type Fault = "none"|"foreign"|"never-exits"|"write-throws"|"write-never-exits";
class InertChild extends EventEmitter {
  readonly pid=4242;readonly stdout=new EventEmitter();readonly stderr=new EventEmitter();readonly stdin=new EventEmitter() as EventEmitter & {write(value:string):boolean};
  killed=0;closed=false;
  constructor(readonly fault:Fault="none") {
    super();this.stdin.write=(value:string)=>{if(this.fault.startsWith("write-"))throw new Error("inert pipe write failure");queueMicrotask(()=>{
      if(value.startsWith("ROOT\t"))this.stdout.emit("data",Buffer.from(frame()+"\n"));
      else if(value.startsWith("CHILD\t"))this.stdout.emit("data",Buffer.from(frame(1,"F")+"\n"));
      else if(value==="RELEASE\n"){this.stdout.emit("data",Buffer.from("released\n"));setImmediate(()=>this.close(0));}
    });return true;};
    queueMicrotask(()=>this.stdout.emit("data",Buffer.from(`aisb-file-id-v1\t${fault==="foreign"||fault==="never-exits"?9:this.pid}\n`)));
  }
  close(code:number){if(!this.closed){this.closed=true;this.emit("close",code,null);}}
  kill(){this.killed++;if(this.fault==="never-exits"||this.fault==="write-never-exits")throw new Error("inert termination unavailable");queueMicrotask(()=>this.close(9));return true;}
}
function launchFixture(fault:Fault="none") {
  const children:InertChild[]=[];
  const launch=mock.method(childProcess,"spawn",(_file:string,args:readonly string[],options:childProcess.SpawnOptions)=>{
    assert.deepEqual(args,[]);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.deepEqual(Object.keys(options.env!).sort(),["SystemRoot","WINDIR"]);
    const child=new InertChild(fault);children.push(child);return child as unknown as childProcess.ChildProcess;
  });syncBuiltinESMExports();return {children,launch};
}
test("private adapter enforces binary hash before launching",{skip:process.platform!=="win32"||process.arch!=="x64"},async()=>{
  const options=await executable();const {launch}=launchFixture();
  await assert.rejects(createWindowsModelFileIdentityAdapter({...options,binarySha256:"f".repeat(64)}).acquire("C:\\owned",identity),{code:"unavailable"});assert.equal(launch.mock.callCount(),0);
});
test("private adapter returns bounded frozen facts and confirms release through owned process close",{skip:process.platform!=="win32"||process.arch!=="x64"},async()=>{
  const options=await executable();const {children}=launchFixture();const adapter=createWindowsModelFileIdentityAdapter(options);const lease=await adapter.acquire("C:\\owned",identity);
  assert.equal((await lease.inspectChild(0,"weights.safetensors","F",identity)).fileId,identity.fileId);assert.ok(Object.isFrozen(lease.root));await lease.release();assert.equal(children[0]!.closed,true);assert.equal(children[0]!.killed,0);
});
test("foreign native identity denies and confirmed shutdown permits a later lease",{skip:process.platform!=="win32"||process.arch!=="x64"},async()=>{
  const options=await executable();const fixture=launchFixture("foreign");await assert.rejects(createWindowsModelFileIdentityAdapter(options).acquire("C:\\owned",identity),{code:"unavailable"});assert.ok(fixture.children[0]!.killed);mock.restoreAll();syncBuiltinESMExports();launchFixture();const lease=await createWindowsModelFileIdentityAdapter(options).acquire("C:\\owned",identity);await lease.release();
});
test("stale released lease cannot clear the active claim belonging to a newer lease",{skip:process.platform!=="win32"||process.arch!=="x64"},async()=>{
  const options=await executable();launchFixture();const adapter=createWindowsModelFileIdentityAdapter(options);const first=await adapter.acquire("C:\\owned",identity);await first.release();const second=await adapter.acquire("C:\\owned",identity);await assert.rejects(first.release(),{code:"unavailable"});await assert.rejects(adapter.acquire("C:\\owned",identity),{code:"unavailable"});await second.release();
});
test("synchronous pipe failure denies without orphan rejection and confirms native close",{skip:process.platform!=="win32"||process.arch!=="x64"},async()=>{
  const options=await executable();const {children}=launchFixture("write-throws");
  await assert.rejects(createWindowsModelFileIdentityAdapter(options).acquire("C:\\owned",identity),{code:"unavailable"});
  assert.equal(children[0]!.closed,true);assert.ok(children[0]!.killed);
  // An orphan is reported by node:test even though acquire rejection is handled.
  await new Promise(resolve=>setImmediate(resolve));
  mock.restoreAll();syncBuiltinESMExports();launchFixture();const lease=await createWindowsModelFileIdentityAdapter(options).acquire("C:\\owned",identity);await lease.release();
});
// Last: the real per-process fence has no test reset or production bypass.
test("synchronous pipe failure with unconfirmed child close latches admission across instances",{skip:process.platform!=="win32"||process.arch!=="x64",timeout:5000},async()=>{
  const options=await executable();const {launch}=launchFixture("write-never-exits");await assert.rejects(createWindowsModelFileIdentityAdapter(options).acquire("C:\\owned",identity),{code:"unavailable"});const count=launch.mock.callCount();await assert.rejects(createWindowsModelFileIdentityAdapter(options).acquire("C:\\owned",identity),{code:"unavailable"});assert.equal(launch.mock.callCount(),count);
});
