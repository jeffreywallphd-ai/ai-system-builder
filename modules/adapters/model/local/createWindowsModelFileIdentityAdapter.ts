import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import {
  encodeWindowsIdentityChild, encodeWindowsIdentityRoot, parseWindowsIdentityOpen,
  WindowsFileIdentityUnavailableError, WINDOWS_IDENTITY_MAX_HANDLES,
  type WindowsFileIdentity, type WindowsFileIdentityFacts,
} from "./windowsModelFileIdentityProtocol";

const LEASE_MS = 10_000;
const SHUTDOWN_MS = 2_000;
let activeLease: symbol | undefined;
let unconfirmedExit = false;
export interface WindowsFileIdentityLease {
  readonly root: WindowsFileIdentityFacts;
  inspectChild(parent: number, name: string, kind: "D" | "F", expected: WindowsFileIdentity): Promise<WindowsFileIdentityFacts>;
  release(): Promise<void>;
}

async function verifyExecutable(executable: string, expectedSha256: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !path.win32.isAbsolute(executable) || !/^[A-Za-z]:\\/.test(executable) || path.extname(executable).toLowerCase() !== ".exe") throw new WindowsFileIdentityUnavailableError();
  let parent = executable;
  for (;;) {
    const stats = await lstat(parent, { bigint: true });
    if (stats.isSymbolicLink()) throw new WindowsFileIdentityUnavailableError();
    const next = path.dirname(parent); if (next === parent) break; parent = next;
  }
  const handle = await open(executable, "r");
  try {
    const before = await lstat(executable, { bigint: true }); const opened = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev === 0n || before.ino === 0n || before.size < 1n || before.size > 16n * 1024n * 1024n || before.dev !== opened.dev || before.ino !== opened.ino) throw new WindowsFileIdentityUnavailableError();
    const hash = createHash("sha256"); const bytes = Buffer.alloc(65536); let count = 0;
    for (;;) { const read = await handle.read(bytes, 0, bytes.length, null); if (!read.bytesRead) break; count += read.bytesRead; if (count > 16 * 1024 * 1024) throw new WindowsFileIdentityUnavailableError(); hash.update(bytes.subarray(0, read.bytesRead)); }
    const after = await lstat(executable, { bigint: true });
    if (hash.digest("hex") !== expectedSha256 || BigInt(count) !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.isSymbolicLink() || after.nlink !== 1n) throw new WindowsFileIdentityUnavailableError();
  } finally { await handle.close(); }
}

class NativeSession {
  private text = "";
  private outputBytes = 0;
  private lines: string[] = [];
  private pending?: { resolve(value: string): void; reject(error: Error): void };
  private failed = false;
  private closed = false;
  private exit?: { code: number | null; signal: NodeJS.Signals | null };
  private readonly exitPromise: Promise<void>;
  private readonly timer: NodeJS.Timeout;
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    this.exitPromise = new Promise(resolve => child.once("close", (code, signal) => { this.closed = true; this.exit = { code, signal }; resolve(); }));
    child.on("error", () => this.fail());
    child.stdin.on("error", () => this.fail());
    child.stdout.on("error", () => this.fail());
    child.stderr.on("error", () => this.fail());
    child.stderr.on("data", () => this.fail());
    child.stdout.on("data", (chunk: Buffer) => {
      this.outputBytes += chunk.length;
      if (this.outputBytes > 16 * 1024 || [...chunk].some(byte => byte !== 9 && byte !== 10 && (byte < 32 || byte > 126))) { this.fail(); return; }
      this.text += chunk.toString("ascii");
      for (;;) {
        const newline = this.text.indexOf("\n"); if (newline < 0) break;
        const line = this.text.slice(0, newline); this.text = this.text.slice(newline + 1);
        if (line.length > 256) { this.fail(); return; }
        if (this.pending) { const pending = this.pending; this.pending = undefined; pending.resolve(line); }
        else if (this.lines.length < 2) this.lines.push(line);
        else { this.fail(); return; }
      }
      if (this.text.length > 256) this.fail();
    });
    this.timer = setTimeout(() => this.fail(), LEASE_MS);
    child.once("close", () => { if (this.pending) { this.pending.reject(new WindowsFileIdentityUnavailableError()); this.pending = undefined; } });
  }
  private fail(): void {
    this.failed = true;
    this.pending?.reject(new WindowsFileIdentityUnavailableError()); this.pending = undefined;
    if (!this.closed) {
      // A failed kill is never proof of exit. Shutdown still waits for the
      // exact ChildProcess close, and fences future admission if it is absent.
      try { this.child.kill("SIGKILL"); } catch { /* retain failed state */ }
    }
  }
  async line(request?: string): Promise<string> {
    if (this.failed || this.pending || this.closed) throw new WindowsFileIdentityUnavailableError();
    const line = this.lines.length ? Promise.resolve(this.lines.shift()!) : new Promise<string>((resolve, reject) => { this.pending = { resolve, reject }; });
    if (request) {
      try { this.child.stdin.write(request); }
      catch { this.fail(); }
    }
    // Even a synchronous write failure must adopt the pending response Promise.
    // Otherwise shutdown rejects an orphan and escapes the handled denial.
    return await line;
  }
  async shutdown(success: boolean): Promise<void> {
    if (!success) this.fail();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([this.exitPromise, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new WindowsFileIdentityUnavailableError()), SHUTDOWN_MS); })]);
      if (success && (this.failed || this.exit?.code !== 0 || this.exit.signal !== null || this.lines.length || this.text)) throw new WindowsFileIdentityUnavailableError();
    } catch {
      if (!this.closed) { unconfirmedExit = true; this.fail(); }
      throw new WindowsFileIdentityUnavailableError();
    } finally { if (timeout) clearTimeout(timeout); clearTimeout(this.timer); }
  }
}

/** Internal prerequisite only; deliberately absent from model feature composition. */
export function createWindowsModelFileIdentityAdapter(options: { readonly executablePath: string; readonly binarySha256: string }) {
  const executable = options.executablePath; const binarySha256 = options.binarySha256;
  return {
    async acquire(rootDirectory: string, expected: WindowsFileIdentity): Promise<WindowsFileIdentityLease> {
      if (process.platform !== "win32" || process.arch !== "x64" || activeLease || unconfirmedExit) throw new WindowsFileIdentityUnavailableError();
      const rootRequest = encodeWindowsIdentityRoot(rootDirectory, expected);
      const identity = { volume: expected.volume, fileId: expected.fileId };
      const claim = Symbol("native-readonly-lease"); activeLease = claim;
      const releaseClaim = () => { if (activeLease === claim) activeLease = undefined; };
      let session: NativeSession | undefined;
      try {
        await verifyExecutable(executable, binarySha256);
        session = new NativeSession(spawn(executable, [], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } }));
        if (await session.line() !== `aisb-file-id-v1\t${session.child.pid}`) throw new WindowsFileIdentityUnavailableError();
        const root = parseWindowsIdentityOpen(await session.line(rootRequest));
        if (root.index !== 0 || root.kind !== "D" || root.volume !== identity.volume || root.fileId !== identity.fileId) throw new WindowsFileIdentityUnavailableError();
        const owner = session; const objects = [root]; let busy = false; let ended = false;
        const abort = async (): Promise<never> => { ended = true; try { await owner.shutdown(false); } finally { releaseClaim(); } throw new WindowsFileIdentityUnavailableError(); };
        return {
          root,
          async inspectChild(parent, name, kind, identity) {
            if (ended || busy || !objects[parent] || objects[parent]!.kind !== "D" || objects.length >= WINDOWS_IDENTITY_MAX_HANDLES) return abort();
            busy = true;
            try {
              const expectedChild = { volume: identity.volume, fileId: identity.fileId };
              const request = encodeWindowsIdentityChild(parent, name, kind, expectedChild);
              const facts = parseWindowsIdentityOpen(await owner.line(request));
              if (facts.index !== objects.length || facts.kind !== kind || facts.volume !== root.volume || facts.volume !== expectedChild.volume || facts.fileId !== expectedChild.fileId) return abort();
              objects.push(facts); return facts;
            } catch { return abort(); }
            finally { busy = false; }
          },
          async release() {
            if (ended || busy) return abort();
            busy = true; ended = true;
            try {
              if (await owner.line("RELEASE\n") !== "released") throw new WindowsFileIdentityUnavailableError();
              await owner.shutdown(true);
            } catch { await owner.shutdown(false); throw new WindowsFileIdentityUnavailableError(); }
            finally { releaseClaim(); }
          },
        };
      } catch {
        try { if (session) await session.shutdown(false); }
        finally { releaseClaim(); }
        throw new WindowsFileIdentityUnavailableError();
      }
    },
  };
}
