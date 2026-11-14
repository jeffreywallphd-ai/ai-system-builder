import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { request } from "node:https";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ElectronApplication } from "playwright";
import { createDesktopPinnedLoopbackAgent } from "../../../../../modules/adapters/transport/headless-loopback";
import { readHeadlessAuthoringWireResult } from "../../../../../modules/contracts/headless";
import { pickFormDesktopSystemEnvironment } from "./form-composer-desktop-profile";

export function prepareHeadlessDesktopProfile(mode: "author" | "conversation" | "presentation" = "author") {
  const root = process.cwd();
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  assert.ok(runId && /^[a-z0-9-]{20,80}$/.test(runId), "The Headless Desktop test requires the owned run identity.");
  const runKey = createHash("sha256").update(runId).digest("hex").slice(0, 16);
  const base = path.join(root, "artifacts", "qualification", "visual-composer", "d", runKey, "desktop");
  assert.ok(process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT === base && realpathSync(base) === base,
    "The Headless Desktop profile must be within the physical run root.");
  const dataRoot = path.join(base, mode === "conversation" ? "headless-conversation" :
    mode === "presentation" ? "headless-presentation" : "headless-paired");
  assert.ok(!lstatSync(dataRoot, { throwIfNoEntry: false }), "The Headless Desktop test requires a fresh profile.");
  mkdirSync(dataRoot);
  assert.ok(realpathSync(dataRoot) === dataRoot, "The Headless Desktop profile cannot redirect.");
  const cache = path.join(dataRoot, mode === "conversation" ? "controlled-model-cache" : "unused-model-cache");
  if (mode === "conversation") mkdirSync(cache);
  const env = { ...pickFormDesktopSystemEnvironment(process.env), VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot,
    HF_HUB_CACHE: cache,
    ...(mode === "conversation" ? {
      PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43172", PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43172",
      PYTHON_RUNTIME_COMMAND: process.execPath, PYTHON_RUNTIME_STARTUP_TIMEOUT_MS: "15000",
      PYTHON_RUNTIME_ARGS: "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",
      PYTHON_RUNTIME_WORKER_DIR: root, PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "headless-conversation",
    } : {}) };
  const seed = spawnSync(path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx",
      "dev-tools/scripts/qualification/visual-composer/visual-composer-desktop-seed.ts"],
    { cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30_000 });
  assert.ok(seed.status === 0, "Unable to seed the owned Headless Desktop profile.");
  return { dataRoot, env, executablePath: path.join(root, "out", "ai-system-builder-win32-x64", "ai-system-builder.exe") };
}

export function seedApprovedHeadlessConversation(profile: ReturnType<typeof prepareHeadlessDesktopProfile>, workspaceId: string, modelRecordId: string) {
  const root = process.cwd();
  const seed = spawnSync(path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx",
      "dev-tools/scripts/qualification/visual-composer/headless-approved-conversation-seed.ts"],
    { cwd: root, env: { ...profile.env, ELECTRON_RUN_AS_NODE: "1", AISB_QUALIFICATION_WORKSPACE: workspaceId,
      AISB_QUALIFICATION_MODEL: modelRecordId }, windowsHide: true, timeout: 30_000 });
  assert.ok(seed.status === 0, "Unable to seed the isolated approved conversation.");
}

export async function installPairingDialogDriver(app: ElectronApplication, confirm: boolean, mode: "author" | "conversation" | "presentation" = "author") {
  await app.evaluate(({ dialog, BrowserWindow }, { allow, mode }) => {
    const testProcess = globalThis as typeof globalThis & {
      headlessTestCode?: string; headlessTestConfirmations?: number; headlessOriginalDialog?: typeof dialog.showMessageBox;
    };
    const original = testProcess.headlessOriginalDialog ??= dialog.showMessageBox;
    dialog.showMessageBox = ((owner: Electron.BrowserWindow, options: Electron.MessageBoxOptions) => {
      if (options?.title === "Pair a chat client" && owner === BrowserWindow.getFocusedWindow() &&
          options.message === (mode === "conversation" ? "Allow a local chat client to read saved systems and run approved conversations?"
            : mode === "presentation" ? "Allow this chat client to ask for control of a window?"
            : "Allow a local chat client to edit saved systems?") &&
          options.buttons?.[1] === "Create pairing code" && options.defaultId === 0 && options.cancelId === 0) {
        testProcess.headlessTestConfirmations = (testProcess.headlessTestConfirmations ?? 0) + 1;
        return Promise.resolve({ response: allow ? 1 : 0, checkboxChecked: false });
      }
      if (options?.title === "One-time pairing code" && owner === BrowserWindow.getFocusedWindow()) {
        testProcess.headlessTestCode = options.detail?.match(/^Code: ([A-Za-z0-9_-]{43})$/m)?.[1];
        return Promise.resolve({ response: 0, checkboxChecked: false });
      }
      if (options?.title === "Turn on the local connector" && owner === BrowserWindow.getFocusedWindow() &&
          options.buttons?.[1] === "Turn on" && options.defaultId === 0 && options.cancelId === 0) {
        return Promise.resolve({ response: allow ? 1 : 0, checkboxChecked: false });
      }
      return (original as (owner: Electron.BrowserWindow, options: Electron.MessageBoxOptions) =>
        Promise<Electron.MessageBoxReturnValue>).call(dialog, owner, options);
    }) as typeof dialog.showMessageBox;
  }, { allow: confirm, mode });
}

export async function takePairingCode(app: ElectronApplication): Promise<string> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const code = await app.evaluate(() => {
      const owner = globalThis as typeof globalThis & { headlessTestCode?: string };
      const code = owner.headlessTestCode;
      delete owner.headlessTestCode;
      return code;
    });
    if (typeof code === "string" && code.length === 43) return code;
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
  throw new Error("The confirmed pairing code was not issued.");
}

export async function exchangePairing(address: string, fingerprint: string, pairingCode: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Owned desktop pairing did not complete."));
    const body = JSON.stringify({ pairingCode });
    const exchange = request(new URL("/aisb-headless/v1/pair", address), {
      agent: createDesktopPinnedLoopbackAgent(address, fingerprint), method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8").on("data", (chunk: string) => {
        if (raw.length + chunk.length > 4096) { exchange.destroy(); fail(); return; }
        raw += chunk;
      });
      response.on("error", fail).on("end", () => {
        try {
          const parsed = JSON.parse(raw) as { value?: { credential?: string } };
          const credential = parsed.value?.credential;
          if (response.statusCode === 200 && credential && /^[A-Za-z0-9_-]{43}$/.test(credential) && credential.length === 43)
            resolve(credential);
          else fail();
        } catch { fail(); }
      });
    });
    exchange.setTimeout(5000, () => { exchange.destroy(); fail(); });
    exchange.on("error", fail).end(body);
  });
}

export async function connectMcp(address: string, fingerprint: string, credential: string, onDroppedCommittedCreate?: () => void,
  mode: "author" | "conversation" | "presentation" = "author") {
  const client = new Client({ name: "packaged-headless-fixture", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["--import", "tsx", "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts"],
    env: { AISB_HEADLESS_ENDPOINT: address, AISB_HEADLESS_FINGERPRINT: fingerprint,
      AISB_HEADLESS_CREDENTIAL: credential, ...(mode === "conversation" ? { AISB_HEADLESS_ENABLE_CONVERSATION: "1" }
        : mode === "presentation" ? { AISB_HEADLESS_ENABLE_PRESENTATION: "1" }
        : { AISB_HEADLESS_ENABLE_AUTHORING: "1" }), TSX_DISABLE_CACHE: "1" },
    stderr: "ignore", maxBufferSize: 256 * 1024,
  });
  try { await client.connect(transport); }
  catch { await client.close(); throw new Error("The owned MCP process did not connect."); }
  if (onDroppedCommittedCreate) {
    let createRequestId: string | number | undefined;
    const send = transport.send.bind(transport);
    transport.send = (message) => {
      if ("id" in message && "method" in message && message.method === "tools/call" &&
          message.params?.name === "aisb_create_system") createRequestId = message.id;
      return send(message);
    };
    const receive = transport.onmessage;
    transport.onmessage = (message) => {
      if (createRequestId !== undefined && "id" in message && message.id === createRequestId &&
          "result" in message && isCommittedCreateReply(message.result)) {
        // Drop the committed reply for this exact request before the SDK can see it.
        transport.send = send;
        transport.onmessage = receive;
        onDroppedCommittedCreate();
        void client.close().catch(() => undefined);
        return;
      }
      receive?.(message);
    };
  }
  return client;
}

function isCommittedCreateReply(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content) ||
      result.content.length !== 1) return false;
  const [block] = result.content;
  if (block?.type !== "text" || typeof block.text !== "string") return false;
  try {
    const reply = readHeadlessAuthoringWireResult(JSON.parse(block.text));
    return reply.ok && reply.value.kind === "committed";
  } catch { return false; }
}
