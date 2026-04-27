import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "../../../../modules/testing/node-test";

import { createServer } from "../createServer";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map(async (root) => rm(root, { recursive: true, force: true })));
  tempRoots.splice(0, tempRoots.length);
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "server-upload-app-"));
  tempRoots.push(root);
  return root;
}

describe("server app artifact upload route", () => {
  it("mounts the upload route and stores image bytes through the server host use case", async () => {
    const storageRootDirectory = await createTempRoot();
    const { app } = createServer({
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
        new File([new Uint8Array([137, 80, 78, 71])], "cat.png", { type: "image/png" }),
      );
      uploadFormData.append("source", "server.integration.test");

      const response = await fetch(`http://127.0.0.1:${address.port}/api/artifact/upload`, {
        method: "POST",
        headers: {
          "x-request-id": "req-server-1",
          "x-correlation-id": "corr-server-1",
        },
        body: uploadFormData,
      });

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
              key: expect.stringMatching(/^uploads\/.+\.png$/),
              mediaType: "image/png",
              sizeBytes: 4,
            },
          },
        },
      });

      const storedKey = payload.value.descriptor.storage.key as string;
      const storedBytes = await readFile(path.join(storageRootDirectory, ...storedKey.split("/")));
      expect(new Uint8Array(storedBytes)).toEqual(new Uint8Array([137, 80, 78, 71]));
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
    const { app } = createServer({
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
        new File([new Uint8Array([80, 75, 3, 4])], "cat.zip", { type: "application/zip" }),
      );
      uploadFormData.append("source", "server.integration.test.invalid-media-type");

      const response = await fetch(`http://127.0.0.1:${address.port}/api/artifact/upload`, {
        method: "POST",
        body: uploadFormData,
      });

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
