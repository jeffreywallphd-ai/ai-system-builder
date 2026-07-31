// @test-duration long
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createInMemoryStructuredDocumentStore } from "../../../../modules/adapters/persistence/shared";
import { createServer } from "../createServer";

test("managed deployment shapes select PostgreSQL and close it gracefully", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "server-postgres-selection-"));
  let closed = false;
  try {
    const created = await createServer({
      env: {
        DEPLOYMENT_SHAPE: "cloud",
        SERVER_STORAGE_ROOT: path.join(root, "storage"),
        SERVER_RUNTIME_ROOT: path.join(root, "runtime"),
      },
      postgresDatabase: {
        documents: createInMemoryStructuredDocumentStore(),
        async checkHealth() {
          return { healthy: true, schemaVersion: 1, expectedSchemaVersion: 1, queryLatencyMs: 1, pool: { total: 1, idle: 1, waiting: 0, idleClientErrorCount: 0 } };
        },
        async close() { closed = true; },
      },
    });
    assert.equal(created.config.deploymentShape, "cloud");
    assert.equal(created.config.persistenceAdapter, "postgres");
    await created.closePersistence();
    assert.equal(closed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operational health routes expose sanitized PostgreSQL readiness", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "server-postgres-readiness-"));
  const secret = "postgresql://user:top-secret@db.example/app";
  const created = await createServer({
    env: {
      DEPLOYMENT_SHAPE: "campus-server",
      SERVER_STORAGE_ROOT: path.join(root, "storage"),
      SERVER_RUNTIME_ROOT: path.join(root, "runtime"),
    },
    postgresDatabase: {
      documents: createInMemoryStructuredDocumentStore(),
      async checkHealth() { throw new Error(secret); },
      async close() {},
    },
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listener = created.app.listen(0, () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const live = await fetch(`http://127.0.0.1:${address.port}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "live" });

    const ready = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(ready.status, 503);
    const body = JSON.stringify(await ready.json());
    assert.match(body, /not-ready/);
    assert.doesNotMatch(body, /top-secret|db\.example/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await created.closePersistence();
    await rm(root, { recursive: true, force: true });
  }
});

test("readiness reports schema, pool pressure, latency, and artifact capacity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "server-postgres-ready-"));
  const storage = path.join(root, "storage");
  await mkdir(storage, { recursive: true });
  const created = await createServer({
    env: {
      DEPLOYMENT_SHAPE: "corporate-server",
      SERVER_STORAGE_ROOT: storage,
      SERVER_RUNTIME_ROOT: path.join(root, "runtime"),
    },
    postgresDatabase: {
      documents: createInMemoryStructuredDocumentStore(),
      async checkHealth() {
        return { healthy: true, schemaVersion: 1, expectedSchemaVersion: 1, queryLatencyMs: 2.5, pool: { total: 4, idle: 3, waiting: 1, idleClientErrorCount: 0 } };
      },
      async close() {},
    },
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listener = created.app.listen(0, () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const ready = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(ready.status, 200);
    const body = await ready.json() as {
      status: string;
      checks: { persistence: Record<string, unknown>; artifactStorage: Record<string, unknown> };
    };
    assert.equal(body.status, "ready");
    assert.deepEqual(body.checks.persistence, {
      status: "ready", adapter: "postgres", schemaVersion: 1, expectedSchemaVersion: 1,
      queryLatencyMs: 2.5, pool: { total: 4, idle: 3, waiting: 1, idleClientErrorCount: 0 },
    });
    assert.equal(body.checks.artifactStorage.status, "ready");
    assert.match(String(body.checks.artifactStorage.availableBytes), /^\d+$/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await created.closePersistence();
    await rm(root, { recursive: true, force: true });
  }
});

test("production server startup requires an explicit deployment shape", async () => {
  await assert.rejects(() => createServer({ env: { NODE_ENV: "production" } }), /DEPLOYMENT_SHAPE is required/);
});

test("server rejects the desktop-only local deployment shape", async () => {
  await assert.rejects(() => createServer({ env: { DEPLOYMENT_SHAPE: "local" } }), /cannot use the local deployment shape/);
});

test("production server startup requires managed OIDC security", async () => {
  await assert.rejects(
    () => createServer({ env: { NODE_ENV: "production", DEPLOYMENT_SHAPE: "cloud" } }),
    /requires AI_SYSTEM_BUILDER_SECURITY_MODE=oidc-bearer/,
  );
});
