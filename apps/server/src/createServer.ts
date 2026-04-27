import path from "node:path";

import express from "express";

import { composeServerHost } from "../../../modules/hosts/server";

export const DEFAULT_SERVER_PORT = 3010;
export const DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME = "server-artifacts";

export interface ServerRuntimeConfig {
  port: number;
  storageRootDirectory: string;
}

export interface CreateServerOptions {
  env?: NodeJS.ProcessEnv;
}

export interface CreatedServer {
  app: express.Express;
  config: ServerRuntimeConfig;
}

function normalizePort(rawPort: string | undefined): number {
  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return DEFAULT_SERVER_PORT;
  }

  return parsedPort;
}

export function resolveDefaultServerStorageRootDirectory(): string {
  return path.resolve(
    __dirname,
    "..",
    DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME,
  );
}

export function resolveServerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ServerRuntimeConfig {
  const storageRootFromEnv = env.SERVER_STORAGE_ROOT?.trim();

  return {
    port: normalizePort(env.PORT),
    storageRootDirectory:
      storageRootFromEnv && storageRootFromEnv.length > 0
        ? path.resolve(storageRootFromEnv)
        : resolveDefaultServerStorageRootDirectory(),
  };
}

export function createServer(options: CreateServerOptions = {}): CreatedServer {
  const config = resolveServerRuntimeConfig(options.env);
  const serverHost = composeServerHost({
    logging: {
      verbosity: options.env?.LOG_VERBOSITY,
      level: "info",
    },
    artifactRepo: {
      huggingFaceAccessToken: options.env?.HF_TOKEN ?? options.env?.HUGGING_FACE_TOKEN,
      huggingFaceTokenConfigFilePath: path.join(config.storageRootDirectory, "config", "hugging-face-token.json"),
    },
  });

  const app = express();
  app.use(express.json({ limit: "5mb" }));

  serverHost.registerApi({
    app,
    storageRootDirectory: config.storageRootDirectory,
  });

  return {
    app,
    config,
  };
}
