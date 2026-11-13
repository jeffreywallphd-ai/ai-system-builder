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
import { pickFormDesktopSystemEnvironment } from "./form-composer-desktop-profile";

export function prepareHeadlessDesktopProfile() {
  const root = process.cwd();
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  assert.ok(runId && /^[a-z0-9-]{20,80}$/.test(runId), "The Headless Desktop test requires the owned run identity.");
  const runKey = createHash("sha256").update(runId).digest("hex").slice(0, 16);
  const base = path.join(root, "artifacts", "qualification", "visual-composer", "d", runKey, "desktop");
  assert.ok(process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT === base && realpathSync(base) === base,
    "The Headless Desktop profile must be within the physical run root.");
  const dataRoot = path.join(base, "headless-paired");
  assert.ok(!lstatSync(dataRoot, { throwIfNoEntry: false }), "The Headless Desktop test requires a fresh profile.");
  mkdirSync(dataRoot);
  assert.ok(realpathSync(dataRoot) === dataRoot, "The Headless Desktop profile cannot redirect.");
  const env = { ...pickFormDesktopSystemEnvironment(process.env), VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot,
    HF_HUB_CACHE: path.join(dataRoot, "unused-model-cache") };
  const seed = spawnSync(path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx",
      "dev-tools/scripts/qualification/visual-composer/visual-composer-desktop-seed.ts"],
    { cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30_000 });
  assert.ok(seed.status === 0, "Unable to seed the owned Headless Desktop profile.");
  return { dataRoot, env, executablePath: path.join(root, "out", "ai-system-builder-win32-x64", "ai-system-builder.exe") };
}

export async function installPairingDialogDriver(app: ElectronApplication, confirm: boolean) {
  await app.evaluate(({ dialog, BrowserWindow }, allow) => {
    const testProcess = globalThis as typeof globalThis & {
      headlessTestCode?: string; headlessTestConfirmations?: number; headlessOriginalDialog?: typeof dialog.showMessageBox;
    };
    const original = testProcess.headlessOriginalDialog ??= dialog.showMessageBox;
    dialog.showMessageBox = ((owner: Electron.BrowserWindow, options: Electron.MessageBoxOptions) => {
      if (options?.title === "Pair a chat client" && owner === BrowserWindow.getFocusedWindow() &&
          options.message === "Allow a local chat client to edit saved systems?" &&
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
      return original.call(dialog, owner, options);
    }) as typeof dialog.showMessageBox;
  }, confirm);
}

export async function takePairingCode(app: ElectronApplication): Promise<string> {
  const code = await app.evaluate(() => {
    const owner = globalThis as typeof globalThis & { headlessTestCode?: string };
    const code = owner.headlessTestCode;
    delete owner.headlessTestCode;
    return code;
  });
  if (typeof code !== "string" || code.length !== 43) throw new Error("The confirmed pairing code was not issued.");
  return code;
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

export async function connectMcp(address: string, fingerprint: string, credential: string) {
  const client = new Client({ name: "packaged-headless-fixture", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["--import", "tsx", "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts"],
    env: { AISB_HEADLESS_ENDPOINT: address, AISB_HEADLESS_FINGERPRINT: fingerprint,
      AISB_HEADLESS_CREDENTIAL: credential, AISB_HEADLESS_ENABLE_AUTHORING: "1", TSX_DISABLE_CACHE: "1" },
    stderr: "ignore", maxBufferSize: 256 * 1024,
  });
  try { await client.connect(transport); }
  catch { await client.close(); throw new Error("The owned MCP process did not connect."); }
  return client;
}
