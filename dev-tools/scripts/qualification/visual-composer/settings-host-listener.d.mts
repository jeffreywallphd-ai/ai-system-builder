import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";

export function listenSettingsHostOnLoopback(
  listener: HttpServer | HttpsServer,
  port: number,
): Promise<void>;
