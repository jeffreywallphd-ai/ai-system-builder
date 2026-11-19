/** Private cooperative receiver custody. No HTTP, actor approval or Model save. */
import {createHash, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {constants, type BigIntStats, type Dir} from "node:fs";
import {lstat, realpath, mkdir, opendir, open, unlink, rmdir, type FileHandle} from "node:fs/promises";
import path from "node:path";
import {types} from "node:util";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {isWorkspaceId} from "../../../../contracts/workspace";
import {captureManifestExpectation, capturePassiveModelData, type RuntimeModelDownloadManifest} from "./modelDownloadManifest";
import {captureModelSourceRuntime, readModelSourceIdentityEnvelope, verifyModelSourceIdentityMac,
  type ModelSourceIdentityProbe, type ModelSourceIdentityProof, type ModelSourceRuntimeFileFacts,
  type RuntimeFilesystemIdentity} from "./modelSourceIdentity";

const NAMESPACE = ".aisb-model-source-transfers";
const CAPTURED = Symbol("private-model-source-recipient");
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const invalid = () => new Error("The temporary model receiver could not be confirmed.");
type Identity = {readonly device: string; readonly inode: string};
type Receipt = {readonly task_id: string; readonly handoff_id: string; readonly model_id: string; readonly revision: string;
  readonly manifest_digest: string; readonly recipient_witness: string; readonly file_count: number; readonly size_bytes: number;
  readonly receipt_digest: string};
type Phase = "preparing" | "prepared" | "issued" | "observed" | "acknowledged" | "consumed" | "settled" | "uncertain";
export interface CapturedModelSourceBinding {
  readonly version: "model-source-task-binding-v1";
  readonly taskId: string; readonly acquisitionId: string; readonly handoffId: string;
  readonly modelId: string; readonly revision: string; readonly manifestDigest: string;
}
interface PreparedTransfer {
  readonly version: "model-source-transfer-v1"; readonly acquisitionId: string; readonly handoffId: string;
  readonly roots: {readonly acquisition: Identity; readonly source: Identity; readonly receiver: Identity};
  readonly maximumDurationSeconds: number; readonly allowedOrigins: readonly string[];
}
export interface ModelSourceRecipientOptions {
  /** Trusted host configuration; this module is not exported through a public barrel. */
  readonly cacheRoot: string;
  readonly taskId: string;
  readonly manifest: RuntimeModelDownloadManifest;
  readonly maximumDurationSeconds: number;
  readonly allowedOrigins: readonly string[];
  readonly isCurrent: () => boolean;
  readonly isBusinessAllowed: () => Promise<boolean>;
  /** Existing host lease must retain this actual owner before the first mkdir. */
  readonly captureCustodian: (owner: ModelSourceRecipient) => void;
  readonly identityProbe: ModelSourceIdentityProbe;
}
function identity(value: BigIntStats): Identity {
  if (value.ino <= 0n || value.dev < 0n) throw invalid();
  return {device: value.dev.toString(), inode: value.ino.toString()};
}
const sameIdentity = (left: Identity, right: Identity) => left.device === right.device && left.inode === right.inode;
const sameFile = (left: BigIntStats, right: BigIntStats) => sameIdentity(identity(left), identity(right)) &&
  left.size === right.size && left.nlink === right.nlink && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
function origins(value: unknown): readonly string[] {
  const copied = capturePassiveModelData(value);
  if (!Array.isArray(copied) || copied.length < 1 || copied.length > 4) throw invalid();
  const result = copied.map(origin => {
    if (typeof origin !== "string" || origin.length > 300 ||
        !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::443)?\/?$/.test(origin)) throw invalid();
    const host = new URL(origin).hostname;
    if (host.length > 253 || host.includes("..") || host.endsWith(".")) throw invalid();
    return "https://" + host;
  });
  if (new Set(result).size !== result.length || !result.includes("https://huggingface.co")) throw invalid();
  return Object.freeze(result);
}

/** Keep this exact owner in the existing host task lease, including failed preparation. */
export async function prepareModelSourceRecipient(input: ModelSourceRecipientOptions): Promise<ModelSourceRecipient> {
  let owner: ModelSourceRecipient | undefined;
  try {
    if (types.isProxy(input)) throw invalid();
    const raw = readStrictPassiveRecord(input, ["cacheRoot", "taskId", "manifest", "maximumDurationSeconds", "allowedOrigins",
      "isCurrent", "isBusinessAllowed", "captureCustodian", "identityProbe"]);
    if (typeof raw.cacheRoot !== "string" || !path.isAbsolute(raw.cacheRoot) || raw.cacheRoot.length > 4096 || !uuid(raw.taskId) ||
        !Number.isSafeInteger(raw.maximumDurationSeconds) || (raw.maximumDurationSeconds as number) < 1 ||
        (raw.maximumDurationSeconds as number) > 3600 ||
        ![raw.isCurrent, raw.isBusinessAllowed, raw.captureCustodian].every(value => typeof value === "function")) throw invalid();
    if (types.isProxy(raw.identityProbe)) throw invalid();
    const probe = readStrictPassiveRecord(raw.identityProbe, ["runtimeId", "workerStartedAt", "assertCurrent", "inspect"]);
    if (typeof probe.assertCurrent !== "function" || typeof probe.inspect !== "function") throw invalid();
    const identityProbe = Object.freeze({...captureModelSourceRuntime({runtimeId: probe.runtimeId, workerStartedAt: probe.workerStartedAt}),
      assertCurrent: probe.assertCurrent, inspect: probe.inspect});
    const options = {...raw, cacheRoot: path.resolve(raw.cacheRoot), manifest: captureManifestExpectation(raw.manifest),
      allowedOrigins: origins(raw.allowedOrigins), identityProbe} as unknown as ModelSourceRecipientOptions;
    owner = new ModelSourceRecipient(options, CAPTURED);
    Object.freeze(owner); // Private state stays mutable; callers cannot shadow its public face.
    owner.assertCurrent();
    const captured: unknown = options.captureCustodian(owner);
    if (types.isPromise(captured)) void Promise.prototype.then.call(captured, undefined, () => {});
    if (captured !== undefined) throw invalid();
    owner.assertCurrent();
    await owner.prepare(CAPTURED);
    return owner;
  } catch {
    owner?.retainUncertainty();
    throw Object.assign(invalid(), {code: "model_source_recipient_unconfirmed", stage: owner?.diagnosticStage ?? "input"});
  }
}

export class ModelSourceRecipient {
  #phase: Phase = "preparing";
  #diagnosticStage = "roots";
  #busy = false;
  readonly #options: ModelSourceRecipientOptions;
  readonly #acquisitionId = randomUUID();
  readonly #handoffId = randomUUID();
  #root = "";
  #source = "";
  #receiver = "";
  #snapshot = "";
  #transfer?: PreparedTransfer;
  #receipt?: Receipt;
  readonly #ancestors = new Map<string, Identity>();
  readonly #directories = new Map<string, Identity>();
  readonly #unknownHandles = new Set<FileHandle>();
  readonly #unknownDirectories = new Set<Dir>();
  #verifiedFiles = new Map<string, BigIntStats>();
  #runtimeFiles = new Map<string, ModelSourceRuntimeFileFacts>();
  #runtimeRoots?: ModelSourceIdentityProof["roots"];
  readonly #secret = randomBytes(32);
  #proofPath = "";
  #proofFacts?: BigIntStats;
  constructor(options: ModelSourceRecipientOptions, marker: symbol) {
    if (marker !== CAPTURED) throw invalid();
    this.#options = Object.freeze({...options});
  }
  static #captured(value: unknown): ModelSourceRecipient {
    if (!value || typeof value !== "object" || types.isProxy(value) || !(#options in value)) throw invalid();
    return value as ModelSourceRecipient;
  }
  /** Inspect actual private fields, never caller methods, prototype or toJSON. */
  static capturedBinding(value: unknown): CapturedModelSourceBinding {
    const owner = ModelSourceRecipient.#captured(value), selected = owner.#options.manifest;
    return capturePassiveModelData({version: "model-source-task-binding-v1", taskId: owner.#options.taskId,
      acquisitionId: owner.#acquisitionId, handoffId: owner.#handoffId, modelId: selected.source.modelId,
      revision: selected.source.revision, manifestDigest: selected.manifestDigest});
  }
  /** Private runtime transport only; this is not an actor or scoped-plan grant. */
  static async takeTaskRequest(value: unknown, workspaceId: string, probe: ModelSourceIdentityProbe) {
    const owner = ModelSourceRecipient.#captured(value);
    if (!isWorkspaceId(workspaceId)) throw invalid();
    const expected = readStrictPassiveRecord(probe, ["runtimeId", "workerStartedAt", "assertCurrent", "inspect"]);
    const captured = owner.#options.identityProbe;
    if (Object.keys(expected).length !== 4 || expected.runtimeId !== captured.runtimeId ||
        expected.workerStartedAt !== captured.workerStartedAt || expected.assertCurrent !== captured.assertCurrent ||
        expected.inspect !== captured.inspect) throw invalid();
    return owner.#exclusive("prepared", async () => {
      if (await owner.#options.isBusinessAllowed() !== true) throw invalid();
      owner.assertCurrent();
      await owner.#names(owner.#root, ["source", "receiver"]);
      await owner.#names(owner.#source, []); await owner.#names(owner.#receiver, []);
      await owner.#probe("roots");
      if (await owner.#options.isBusinessAllowed() !== true) throw invalid();
      owner.assertCurrent();
      const manifest = owner.#options.manifest;
      const request = capturePassiveModelData({requestId: owner.#options.taskId, taskType: "ensure-model-download" as const,
        payload: {provider: "transformers" as const, modelId: manifest.source.modelId, revision: manifest.source.revision,
          sourceManifest: manifest, sourceTransfer: owner.#transfer!}, metadata: {workspaceId}});
      owner.#phase = "issued";
      return request;
    });
  }
  get phase(): Phase {return this.#phase;}
  /** Carry original receiver liveness through every transport handoff to fetch. */
  static async dispatchTaskRequest<T>(value: unknown, send: (assertIssued: () => void) => Promise<T>): Promise<T> {
    const owner = ModelSourceRecipient.#captured(value);
    return owner.#exclusive("issued", async () => {
      if (await owner.#options.isBusinessAllowed() !== true) throw invalid();
      const assertIssued = () => {
        if (owner.#phase !== "issued") throw invalid();
        owner.assertCurrent();
      };
      assertIssued();
      const result = await send(assertIssued); assertIssued(); return result;
    });
  }
  get diagnosticStage(): string {return this.#diagnosticStage;}
  get cleanupPending(): boolean {return this.#phase !== "settled";}
  /** Opaque wire data only. No path, callbacks or cleanup owner is serializable. */
  get transfer(): PreparedTransfer {
    if (!this.#transfer || this.#phase !== "prepared") throw invalid();
    return this.#transfer;
  }
  assertCurrent(): void {
    if (this.#phase === "uncertain") throw invalid();
    const result: unknown = this.#options.isCurrent();
    if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
    if (result !== true || (this.#phase as Phase) === "uncertain") throw invalid();
    const owned: unknown = this.#options.identityProbe.assertCurrent();
    if (types.isPromise(owned)) void Promise.prototype.then.call(owned, undefined, () => {});
    if (owned !== undefined || (this.#phase as Phase) === "uncertain") throw invalid();
  }
  retainUncertainty(): void {this.#phase = "uncertain";}
  async #plain(directory: string): Promise<Identity> {
    this.assertCurrent();
    const facts = await lstat(directory, {bigint: true}); this.assertCurrent();
    if (!facts.isDirectory() || facts.isSymbolicLink()) throw invalid();
    const canonical = await realpath(directory); this.assertCurrent();
    if (canonical !== directory) throw invalid();
    const after = await lstat(directory, {bigint: true}); this.assertCurrent();
    if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(identity(facts), identity(after))) throw invalid();
    return identity(facts);
  }
  async #checkRoots(): Promise<void> {
    for (const [directory, expected] of [...this.#ancestors, ...this.#directories])
      if (!sameIdentity(await this.#plain(directory), expected)) throw invalid();
    this.assertCurrent();
  }
  async #names(directory: string, expected: readonly string[]): Promise<void> {
    this.assertCurrent();
    const handle = await opendir(directory); this.#unknownDirectories.add(handle);
    try {
      this.assertCurrent(); const names = new Set<string>();
      for (;;) {
        const entry = await handle.read(); this.assertCurrent();
        if (entry === null) break;
        if (names.size >= expected.length || !expected.includes(entry.name) || names.has(entry.name)) throw invalid();
        names.add(entry.name);
      }
      if (names.size !== expected.length) throw invalid();
    } finally {
      await handle.close(); this.#unknownDirectories.delete(handle); this.assertCurrent();
    }
  }
  async #create(directory: string): Promise<void> {
    await this.#checkRoots(); this.assertCurrent();
    await mkdir(directory); this.assertCurrent();
    this.#directories.set(directory, await this.#plain(directory));
  }
  async prepare(marker: symbol): Promise<void> {
    if (marker !== CAPTURED || this.#phase !== "preparing" || this.#busy) throw invalid();
    this.#busy = true;
    try {
      const chain = []; let next = this.#options.cacheRoot;
      for (;;) {chain.unshift(next); const parent = path.dirname(next); if (parent === next) break; next = parent;}
      if (chain.length > 64) throw invalid();
      for (const directory of chain) this.#ancestors.set(directory, await this.#plain(directory));
      const namespace = path.join(this.#options.cacheRoot, NAMESPACE);
      await this.#checkRoots(); this.assertCurrent();
      try {await mkdir(namespace);}
      catch (error) {if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw invalid();}
      this.assertCurrent();
      this.#ancestors.set(namespace, await this.#plain(namespace));
      this.#root = path.join(namespace, this.#acquisitionId);
      this.#source = path.join(this.#root, "source"); this.#receiver = path.join(this.#root, "receiver");
      await this.#create(this.#root); await this.#create(this.#source); await this.#create(this.#receiver);
      await this.#checkRoots(); await this.#names(this.#root, ["source", "receiver"]);
      await this.#names(this.#source, []); await this.#names(this.#receiver, []);
      this.assertCurrent();
      this.#proofPath = path.join(namespace, this.#acquisitionId + ".proof");
      await this.#createProof();
      this.#runtimeRoots = (await this.#probe("roots")).roots;
      const wireIdentity = (value: RuntimeFilesystemIdentity): Identity => ({device: value[0], inode: value[1]});
      this.#transfer = capturePassiveModelData({version: "model-source-transfer-v1", acquisitionId: this.#acquisitionId,
        handoffId: this.#handoffId, roots: {acquisition: wireIdentity(this.#runtimeRoots.acquisition), source: wireIdentity(this.#runtimeRoots.source),
          receiver: wireIdentity(this.#runtimeRoots.receiver)}, maximumDurationSeconds: this.#options.maximumDurationSeconds,
        allowedOrigins: this.#options.allowedOrigins}) as PreparedTransfer;
      this.#snapshot = path.join(this.#receiver, this.#handoffId, "models--" + this.#options.manifest.source.modelId.replace("/", "--"),
        "snapshots", this.#options.manifest.source.revision);
      this.#phase = "prepared";
    } catch {this.retainUncertainty(); throw invalid();}
    finally {this.#busy = false;}
  }
  markIssued(): PreparedTransfer {
    const transfer = this.transfer;
    if (this.#busy) throw invalid();
    this.assertCurrent(); this.#phase = "issued";
    return transfer;
  }
  async #exclusive<T>(phase: Phase, operation: () => Promise<T>): Promise<T> {
    if (this.#busy || this.#phase !== phase) throw invalid();
    this.#busy = true;
    try {this.assertCurrent(); return await operation();}
    catch {this.retainUncertainty(); throw invalid();}
    finally {this.#busy = false;}
  }
  async #protocolDirectories(): Promise<void> {
    let directory = this.#receiver;
    const segments = [this.#handoffId, "models--" + this.#options.manifest.source.modelId.replace("/", "--"), "snapshots",
      this.#options.manifest.source.revision];
    for (const segment of segments) {
      await this.#names(directory, [segment]); directory = path.join(directory, segment);
      const actual = await this.#plain(directory), expected = this.#directories.get(directory);
      if (expected && !sameIdentity(actual, expected)) throw invalid();
      this.#directories.set(directory, actual);
    }
    await this.#names(this.#snapshot, this.#options.manifest.source.files.map(file => file.path));
  }
  async #createProof(): Promise<void> {
    await this.#checkRoots(); this.assertCurrent();
    this.#diagnosticStage = "proof-open";
    const handle = await open(this.#proofPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    this.#unknownHandles.add(handle);
    try {
      this.assertCurrent(); const initial = await handle.stat({bigint: true}); this.assertCurrent();
      this.#diagnosticStage = "proof-write";
      if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1n || initial.size !== 0n) throw invalid();
      let written = 0;
      while (written < 32) {
        this.assertCurrent(); const next = await handle.write(this.#secret, written, 32 - written, written); this.assertCurrent();
        if (!Number.isSafeInteger(next.bytesWritten) || next.bytesWritten < 1 || next.bytesWritten > 32 - written) throw invalid();
        written += next.bytesWritten;
      }
      this.#diagnosticStage = "proof-sync";
      this.assertCurrent(); await handle.sync(); this.assertCurrent();
      const after = await handle.stat({bigint: true}); this.assertCurrent();
      if (!after.isFile() || after.nlink !== 1n || after.size !== 32n || !sameIdentity(identity(initial), identity(after))) throw invalid();
      this.#proofFacts = after;
    } finally {await handle.close(); this.#unknownHandles.delete(handle); this.assertCurrent();}
    this.#diagnosticStage = "proof-closed-stat";
    // Windows may commit the final write timestamps when this owned writable
    // handle closes. Capture that one known transition without replacing IDs.
    const closed = await lstat(this.#proofPath, {bigint: true}); this.assertCurrent();
    if (!this.#proofFacts || !closed.isFile() || closed.isSymbolicLink() || closed.nlink !== 1n || closed.size !== 32n ||
        closed.mode !== this.#proofFacts.mode || !sameIdentity(identity(closed), identity(this.#proofFacts))) throw invalid();
    this.#proofFacts = closed;
    await this.#verifyProof();
  }
  async #verifyProof(): Promise<void> {
    this.#diagnosticStage = "proof-read";
    await this.#checkRoots(); this.assertCurrent();
    const before = await lstat(this.#proofPath, {bigint: true}); this.assertCurrent();
    if (!this.#proofFacts || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || !sameFile(before, this.#proofFacts)) throw invalid();
    const handle = await open(this.#proofPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); this.#unknownHandles.add(handle);
    try {
      this.assertCurrent(); const initial = await handle.stat({bigint: true}); this.assertCurrent();
      if (!sameFile(initial, before)) throw invalid();
      const bytes = Buffer.alloc(33); let read = 0;
      while (read < 32) {
        this.assertCurrent(); const next = await handle.read(bytes, read, 32 - read, read); this.assertCurrent();
        if (!Number.isSafeInteger(next.bytesRead) || next.bytesRead < 1 || next.bytesRead > 32 - read) throw invalid();
        read += next.bytesRead;
      }
      this.assertCurrent(); const eof = await handle.read(bytes, 32, 1, 32); this.assertCurrent();
      const after = await handle.stat({bigint: true}); this.assertCurrent();
      if (eof.bytesRead !== 0 || !sameFile(initial, after) || !timingSafeEqual(bytes.subarray(0, 32), this.#secret)) throw invalid();
    } finally {await handle.close(); this.#unknownHandles.delete(handle); this.assertCurrent();}
    const after = await lstat(this.#proofPath, {bigint: true}); this.assertCurrent();
    if (!sameFile(before, after)) throw invalid();
  }
  async #probe(phase: "roots" | "snapshot"): Promise<ModelSourceIdentityProof> {
    await this.#verifyProof();
    const input = Object.freeze({phase, taskId: this.#options.taskId, acquisitionId: this.#acquisitionId,
      handoffId: this.#handoffId, challenge: randomBytes(32).toString("hex")});
    const raw = await this.#options.identityProbe.inspect(input); this.assertCurrent();
    this.#diagnosticStage = "identity-schema";
    const envelope = readModelSourceIdentityEnvelope(raw, input, this.#options.identityProbe);
    this.#diagnosticStage = "identity-mac";
    verifyModelSourceIdentityMac(this.#secret, envelope);
    await this.#verifyProof(); await this.#checkRoots();
    if (this.#runtimeRoots) for (const role of ["acquisition", "source", "receiver"] as const)
      if (envelope.proof.roots[role].some((value, index) => value !== this.#runtimeRoots![role][index])) throw invalid();
    this.assertCurrent(); return envelope.proof;
  }
  async #verifyFiles(links: bigint): Promise<{path: string; device: string; inode: string; size: number}[]> {
    await this.#checkRoots(); await this.#names(this.#root, ["source", "receiver"]); await this.#protocolDirectories();
    const verified = new Map<string, BigIntStats>();
    for (const selected of this.#options.manifest.source.files) {
      const filename = path.join(this.#snapshot, selected.path);
      this.assertCurrent(); const before = await lstat(filename, {bigint: true}); this.assertCurrent();
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== links || before.size !== BigInt(selected.sizeBytes)) throw invalid();
      const previous = this.#verifiedFiles.get(selected.path);
      if (previous) {
        const senderTransition = this.#phase === "observed" && previous.nlink === 2n && links === 1n;
        if (!sameIdentity(identity(previous), identity(before)) || previous.mode !== before.mode ||
            previous.size !== before.size || previous.mtimeNs !== before.mtimeNs ||
            (!senderTransition && !sameFile(previous, before))) throw invalid();
      }
      const canonical = await realpath(filename); this.assertCurrent();
      if (canonical !== filename) throw invalid();
      await this.#checkRoots(); this.assertCurrent();
      const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      this.#unknownHandles.add(handle);
      try {
        this.assertCurrent(); const initial = await handle.stat({bigint: true}); this.assertCurrent();
        if (!sameFile(initial, before)) throw invalid();
        const hash = createHash(selected.integrity.algorithm === "sha256" ? "sha256" : "sha1");
        if (selected.integrity.algorithm === "git-blob-sha1") hash.update(`blob ${selected.sizeBytes}\0`);
        const buffer = Buffer.alloc(64 * 1024); let read = 0;
        while (read < selected.sizeBytes) {
          this.assertCurrent();
          const chunk = await handle.read(buffer, 0, Math.min(buffer.length, selected.sizeBytes - read), read);
          this.assertCurrent();
          if (!Number.isSafeInteger(chunk.bytesRead) || chunk.bytesRead < 1 || chunk.bytesRead > Math.min(buffer.length, selected.sizeBytes - read)) throw invalid();
          hash.update(buffer.subarray(0, chunk.bytesRead)); read += chunk.bytesRead;
        }
        this.assertCurrent(); const eof = await handle.read(buffer, 0, 1, read); this.assertCurrent();
        const after = await handle.stat({bigint: true}); this.assertCurrent();
        if (eof.bytesRead !== 0 || !sameFile(initial, after) || hash.digest("hex") !== selected.integrity.digest) throw invalid();
      } finally {
        await handle.close(); this.#unknownHandles.delete(handle); this.assertCurrent();
      }
      const after = await lstat(filename, {bigint: true}); this.assertCurrent();
      if (!sameFile(before, after)) throw invalid();
      verified.set(selected.path, after);
    }
    await this.#checkRoots(); await this.#protocolDirectories();
    const runtime = await this.#probe("snapshot");
    if (runtime.manifestDigest !== this.#options.manifest.manifestDigest || runtime.files.length !== verified.size) throw invalid();
    const files = []; const runtimeFiles = new Map<string, ModelSourceRuntimeFileFacts>();
    for (let index = 0; index < this.#options.manifest.source.files.length; index++) {
      const selected = this.#options.manifest.source.files[index]!, actual = runtime.files[index]!;
      if (actual.path !== selected.path || actual.sizeBytes !== selected.sizeBytes || actual.nlink !== Number(links)) throw invalid();
      const previous = this.#runtimeFiles.get(actual.path);
      if (previous) {
        const transition = this.#phase === "observed" && previous.nlink === 2 && actual.nlink === 1;
        if (actual.identity.some((value, part) => value !== previous.identity[part]) || actual.sizeBytes !== previous.sizeBytes ||
            actual.mtimeNs !== previous.mtimeNs || (!transition && (actual.nlink !== previous.nlink || actual.ctimeNs !== previous.ctimeNs))) throw invalid();
      }
      this.assertCurrent(); const local = await lstat(path.join(this.#snapshot, actual.path), {bigint: true}); this.assertCurrent();
      if (!sameFile(local, verified.get(actual.path)!)) throw invalid();
      runtimeFiles.set(actual.path, actual);
      files.push({path: actual.path, device: actual.identity[0], inode: actual.identity[1], size: actual.sizeBytes});
    }
    this.#verifiedFiles = verified;
    this.#runtimeFiles = runtimeFiles;
    return files;
  }
  async observeReceipt(raw: unknown): Promise<void> {
    return this.#exclusive("issued", async () => {
      const receipt = readStrictPassiveRecord(capturePassiveModelData(raw), ["task_id", "handoff_id", "model_id", "revision",
        "manifest_digest", "recipient_witness", "file_count", "size_bytes", "receipt_digest"]);
      const selected = this.#options.manifest;
      const witness = digest({task: this.#options.taskId, handoff: this.#handoffId,
        root: this.#runtimeRoots!.receiver});
      if (Object.keys(receipt).length !== 9 || receipt.task_id !== this.#options.taskId || receipt.handoff_id !== this.#handoffId ||
          receipt.model_id !== selected.source.modelId || receipt.revision !== selected.source.revision ||
          receipt.manifest_digest !== selected.manifestDigest || receipt.recipient_witness !== witness ||
          receipt.file_count !== selected.source.files.length || receipt.size_bytes !== selected.source.totalBytes ||
          typeof receipt.receipt_digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(receipt.receipt_digest)) throw invalid();
      const files = await this.#verifyFiles(2n);
      if (receipt.receipt_digest !== digest({task: this.#options.taskId, handoff: this.#handoffId,
        manifest: selected.manifestDigest, recipient: witness, files})) throw invalid();
      this.assertCurrent(); this.#receipt = receipt as unknown as Receipt; this.#phase = "observed";
    });
  }
  acknowledgement(phase: "receiver-observed" | "receiver-settled") {
    this.assertCurrent();
    if (!["receiver-observed", "receiver-settled"].includes(phase) || !this.#receipt ||
        (phase === "receiver-observed" ? !["observed", "acknowledged", "consumed"].includes(this.#phase) : this.#phase !== "settled")) throw invalid();
    return capturePassiveModelData({phase, acquisitionId: this.#acquisitionId, handoffId: this.#handoffId,
      receiptDigest: this.#receipt.receipt_digest, recipientWitness: this.#receipt.recipient_witness});
  }
  async confirmSenderCleanup(): Promise<void> {
    return this.#exclusive("observed", async () => {
      await this.#verifyFiles(1n); await this.#names(this.#source, []);
      this.assertCurrent(); this.#phase = "acknowledged";
    });
  }
  async consume<T>(consumer: (snapshot: string) => Promise<T>): Promise<T> {
    return this.#exclusive("acknowledged", async () => {
      if (typeof consumer !== "function" || await this.#options.isBusinessAllowed() !== true) throw invalid();
      this.assertCurrent(); await this.#verifyFiles(1n);
      if (await this.#options.isBusinessAllowed() !== true) throw invalid();
      this.assertCurrent(); const result = await consumer(this.#snapshot); this.assertCurrent();
      if (await this.#options.isBusinessAllowed() !== true) throw invalid();
      this.assertCurrent(); this.#phase = "consumed"; return result;
    });
  }
  async retire(): Promise<void> {
    return this.#exclusive("consumed", async () => {
      await this.#verifyFiles(1n); await this.#names(this.#source, []);
      for (const file of this.#options.manifest.source.files) {
        await this.#checkRoots(); this.assertCurrent();
        const before = await lstat(path.join(this.#snapshot, file.path), {bigint: true}); this.assertCurrent();
        if (!before.isFile() || before.isSymbolicLink() || !sameFile(before, this.#verifiedFiles.get(file.path)!)) throw invalid();
        await unlink(path.join(this.#snapshot, file.path)); this.assertCurrent();
      }
      await this.#retireDirectories();
      await this.#retireProof();
      this.#phase = "settled";
    });
  }
  async retireUnissued(): Promise<void> {
    return this.#exclusive("prepared", async () => {
      await this.#checkRoots(); await this.#names(this.#root, ["source", "receiver"]);
      await this.#names(this.#source, []); await this.#names(this.#receiver, []);
      await this.#retireDirectories(); await this.#retireProof(); this.#phase = "settled";
    });
  }
  async #retireDirectories(): Promise<void> {
    const directories = [...this.#directories.keys()].sort((a, b) => b.length - a.length);
    for (const directory of directories) {
      await this.#checkRoots(); await this.#names(directory, []); this.assertCurrent();
      await rmdir(directory); this.#directories.delete(directory); this.assertCurrent();
    }
  }
  async #retireProof(): Promise<void> {
    await this.#verifyProof(); this.assertCurrent();
    const before = await lstat(this.#proofPath, {bigint: true}); this.assertCurrent();
    if (!sameFile(before, this.#proofFacts!)) throw invalid();
    await unlink(this.#proofPath); this.assertCurrent(); this.#secret.fill(0);
  }
}
