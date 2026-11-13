import { timingSafeEqual } from "node:crypto";
import { Agent } from "node:https";
import { connect } from "node:tls";
import type { Duplex } from "node:stream";
import { isDesktopHeadlessEndpoint, isDesktopHeadlessFingerprint } from "../../../contracts/headless";

/** The HTTP caller receives a socket only after the exact pinned peer has proven its key. */
export function createDesktopPinnedLoopbackAgent(endpoint: string, fingerprint: string): Agent {
  if (!isDesktopHeadlessEndpoint(endpoint) || !isDesktopHeadlessFingerprint(fingerprint)) {
    throw new Error("The local connector identity is invalid.");
  }
  const port = Number(new URL(endpoint).port);
  const expected = Buffer.from(fingerprint, "hex");
  const agent = new Agent({ keepAlive: false, maxSockets: 4, maxCachedSessions: 0 });
  agent.createConnection = (_options, callback: (error: Error | null, socket?: Duplex) => void) => {
    const socket = connect({ host: "127.0.0.1", port, minVersion: "TLSv1.3", rejectUnauthorized: false });
    const timer = setTimeout(() => socket.destroy(new Error("Local connector identity could not be confirmed.")), 4_000);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      callback(new Error("Local connector identity could not be confirmed."));
    };
    socket.once("error", fail);
    socket.once("close", fail);
    socket.once("secureConnect", () => {
      if (settled) return;
      const peer = socket.getPeerX509Certificate();
      const bytes = peer && Buffer.from(peer.fingerprint256.replaceAll(":", ""), "hex");
      const now = Date.now();
      if (!peer || !bytes || bytes.length !== expected.length || !timingSafeEqual(expected, bytes) ||
          !(Date.parse(peer.validFrom) <= now && now < Date.parse(peer.validTo))) {
        fail();
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.off("close", fail);
      socket.off("error", fail);
      // The Agent attaches the HTTP request only inside this callback.
      callback(null, socket);
    });
    return undefined;
  };
  return agent;
}
