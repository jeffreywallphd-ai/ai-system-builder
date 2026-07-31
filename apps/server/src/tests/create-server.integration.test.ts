import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "../../../../modules/testing/node-test";

import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createLocalWorkspaceRepository } from "../../../../modules/adapters/persistence/workspace";
import { createServer } from "../createServer";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map(async (root) =>
      rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  );
  tempRoots.splice(0, tempRoots.length);
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "server-upload-app-"));
  tempRoots.push(root);
  return root;
}

async function seedActiveWorkspace(
  rootDirectory: string,
  workspaceId = "workspace-a",
): Promise<void> {
  await createLocalWorkspaceRepository({ rootDirectory }).saveWorkspace({
    workspaceId: createWorkspaceId(workspaceId),
    displayName: "Workspace A",
    status: "active",
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  });
}

describe("server app artifact upload route", () => {
  it("enforces canonical API routing and authentication before JSON parsing", async () => {
    const storageRootDirectory = await createTempRoot();
    await seedActiveWorkspace(storageRootDirectory);
    const { app } = await createServer({
      env: {
        ...process.env,
        PORT: "0",
        SERVER_STORAGE_ROOT: storageRootDirectory,
        AI_SYSTEM_BUILDER_SECURITY_MODE: "disabled-dev",
        AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED: "true",
      },
    });

    const server = await new Promise<import("node:http").Server>((resolve) => {
      const startedServer = app.listen(0, "127.0.0.1", () =>
        resolve(startedServer),
      );
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a numeric test server port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const malformedPublicResponse = await fetch(
        `${baseUrl}/api/security/dev-mode`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"malformed":',
        },
      );
      expect(malformedPublicResponse.status).toBe(400);
      expect(await malformedPublicResponse.json()).toMatchObject({
        error: {
          operation: "api.request-body",
          message: "Request body could not be parsed.",
        },
      });

      const enableResponse = await fetch(`${baseUrl}/api/security/dev-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "lan-token-enforced" }),
      });
      expect(enableResponse.status).toBe(200);

      for (const routePath of [
        "/api/model/download",
        "/api/image-generation/start",
        "/api/artifact-repo/store",
        "/api/artifact/upload",
      ]) {
        const response = await fetch(`${baseUrl}${routePath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"malformed":',
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
          error: { operation: "security.unauthenticated" },
        });
      }

      for (const routePath of [
        "/API/model/download",
        "/API/image-generation/start",
        "/API/artifact-repo/store",
        "/API/artifact/upload",
      ]) {
        const response = await fetch(`${baseUrl}${routePath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"malformed":',
        });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { operation: "security.route-policy-missing" },
        });
      }

      const healthResponse = await fetch(`${baseUrl}/health/live`);
      expect(healthResponse.status).toBe(200);
      expect(await healthResponse.json()).toEqual({ status: "live" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("mounts the upload route and stores image bytes through the server host use case", async () => {
    const storageRootDirectory = await createTempRoot();
    await seedActiveWorkspace(storageRootDirectory);
    const { app } = await createServer({
      env: {
        ...process.env,
        PORT: "0",
        SERVER_STORAGE_ROOT: storageRootDirectory,
      },
    });

    const server = await new Promise<import("node:http").Server>((resolve) => {
      const startedServer = app.listen(0, () => resolve(startedServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a numeric test server port.");
      }

      const uploadFormData = new FormData();
      uploadFormData.append(
        "file",
        new File(
          [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
          "cat.png",
          { type: "image/png" },
        ),
      );
      uploadFormData.append("source", "server.integration.test");
      uploadFormData.append("workspaceId", "workspace-a");

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/artifact/upload`,
        {
          method: "POST",
          headers: {
            "x-request-id": "req-server-1",
            "x-correlation-id": "corr-server-1",
          },
          body: uploadFormData,
        },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        operation: "artifact.upload",
        requestId: "req-server-1",
        correlationId: "corr-server-1",
        value: {
          descriptor: {
            storage: {
              key: expect.stringMatching(
                /^workspaces\/workspace-a\/artifacts\/files\/.+\.png$/,
              ),
              mediaType: "image/png",
              sizeBytes: 8,
            },
          },
        },
      });

      const storedKey = payload.value.descriptor.storage.key as string;
      const storedBytes = await readFile(
        path.join(storageRootDirectory, ...storedKey.split("/")),
      );
      expect(new Uint8Array(storedBytes)).toEqual(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("returns a client failure envelope when request payload fails use-case validation", async () => {
    const storageRootDirectory = await createTempRoot();
    await seedActiveWorkspace(storageRootDirectory);
    const { app } = await createServer({
      env: {
        ...process.env,
        PORT: "0",
        SERVER_STORAGE_ROOT: storageRootDirectory,
      },
    });

    const server = await new Promise<import("node:http").Server>((resolve) => {
      const startedServer = app.listen(0, () => resolve(startedServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a numeric test server port.");
      }

      const uploadFormData = new FormData();
      uploadFormData.append(
        "file",
        new File([new Uint8Array([80, 75, 3, 4])], "cat.zip", {
          type: "application/zip",
        }),
      );
      uploadFormData.append(
        "source",
        "server.integration.test.invalid-media-type",
      );
      uploadFormData.append("workspaceId", "workspace-a");

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/artifact/upload`,
        {
          method: "POST",
          body: uploadFormData,
        },
      );

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: false,
        operation: "artifact.upload",
        error: {
          code: "validation",
          message: "Artifact type is not accepted: application/zip.",
          kind: "client",
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
