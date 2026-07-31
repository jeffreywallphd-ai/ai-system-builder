#!/usr/bin/env node

import https from "node:https";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const origin = new URL(
  process.env.QUALIFICATION_SERVER_ORIGIN || "https://127.0.0.1:3010",
);
const evidencePath = resolve(
  process.env.DEPLOYMENT_SMOKE_EVIDENCE ||
    "artifacts/qualification/deployment/server-smoke.json",
);

async function request(path) {
  return new Promise((resolveRequest, reject) => {
    const request = https.get(
      new URL(path, origin),
      { rejectUnauthorized: false, timeout: 5_000 },
      (response) => {
        response.resume();
        response.once("end", () => resolveRequest(response.statusCode));
      },
    );
    request.once("timeout", () =>
      request.destroy(new Error("Probe timed out.")),
    );
    request.once("error", reject);
  });
}

async function writeEvidence(value) {
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  await mkdir(dirname(evidencePath), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, evidencePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

const startedAt = new Date();
try {
  const liveStatus = await request("/health/live");
  const readyStatus = await request("/health/ready");
  if (liveStatus !== 200 || readyStatus !== 200) {
    throw new Error("Managed server health probes did not return success.");
  }
  const completedAt = new Date();
  const evidence = {
    kind: "ai-system-builder-managed-server-smoke",
    schemaVersion: 1,
    status: "passed",
    liveStatus,
    readyStatus,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };
  await writeEvidence(evidence);
  process.stdout.write(
    `${JSON.stringify({ operation: "managed-server-smoke", status: "passed", liveStatus, readyStatus })}\n`,
  );
} catch {
  await writeEvidence({
    kind: "ai-system-builder-managed-server-smoke",
    schemaVersion: 1,
    status: "failed",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  });
  throw new Error("Managed server smoke qualification failed.");
}
