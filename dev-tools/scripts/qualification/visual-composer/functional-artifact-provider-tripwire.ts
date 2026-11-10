import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { ControlledHuggingFaceArtifactTransport } from "../../../../apps/server/src/createServer";
import { functionalHostLayout } from "./functional-host-launch-plan.mjs";

export const ARTIFACT_PROVIDER_OBSERVATION_FILE = "functional-artifact-provider-observation.json";
export const ARTIFACT_PROVIDER_ATTEMPT_LIMIT = 1024;
const operations = ["fetch", "fileExists", "uploadFile", "downloadFile", "commit", "listFiles"] as const;
type Operation = typeof operations[number];

/** Trusted fixture transport, not an OS network sandbox. Never retain request arguments. */
export function createFunctionalArtifactProviderTripwire(repoRoot: string, runId: string, sourceRevision: string) {
  const layout = functionalHostLayout(repoRoot, runId, sourceRevision);
  const counts: Record<Operation, number> = { fetch: 0, fileExists: 0, uploadFile: 0, downloadFile: 0, commit: 0, listFiles: 0 };
  let limitReached = false;
  function deny(operation: Operation): never {
    counts[operation] = Math.min(ARTIFACT_PROVIDER_ATTEMPT_LIMIT, counts[operation] + 1);
    if (counts[operation] === ARTIFACT_PROVIDER_ATTEMPT_LIMIT) limitReached = true;
    throw new Error("Provider transport is disabled for this local artifact test.");
  }
  const transport: ControlledHuggingFaceArtifactTransport = Object.freeze({
    fetchImplementation: async () => deny("fetch"),
    hubClient: Object.freeze({
      fileExists: async () => deny("fileExists"),
      uploadFile: async () => deny("uploadFile"),
      downloadFile: async () => deny("downloadFile"),
      commit: async () => deny("commit"),
      listFiles: async function* () { deny("listFiles"); },
    }),
  });
  function snapshot() {
    return Object.freeze({
      schema_version: "functional-artifact-provider-observation-v1" as const,
      mode: "deny" as const, transport_scope: "artifact-hub-and-metadata-fetch" as const,
      run_id: runId, source_revision: sourceRevision,
      attempts: Object.freeze({ ...counts }),
      total_attempts: operations.reduce((sum, name) => sum + counts[name], 0),
      attempt_limit_per_operation: ARTIFACT_PROVIDER_ATTEMPT_LIMIT,
      limit_reached: limitReached,
      request_arguments_recorded: false as const,
      controlled_transport_prevented: true as const,
      brokered_retrieval_qualified: false as const,
      qualification_granted: false as const,
    });
  }
  async function writeObservation() {
    // The fixed fresh-run parent is created by normal server startup. Never create,
    // traverse a link, replace an observation, or accept a caller output path.
    const directory = layout.serverRuntimeRoot;
    const metadata = await lstat(directory, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new Error("The fixed artifact observation directory is unavailable.");
    }
    // Only the trusted entry calls this after createServer returned and its
    // awaited listener/background/persistence shutdown returned successfully.
    const bytes = JSON.stringify({ ...snapshot(), observation_frontier: "after-awaited-server-shutdown",
      guard_installed: true, server_creation_returned: true, server_shutdown_returned: true }) + "\n";
    if (Buffer.byteLength(bytes) > 2048) throw new Error("The fixed artifact observation exceeds its bound.");
    const file = await open(path.join(directory, ARTIFACT_PROVIDER_OBSERVATION_FILE), "wx", 0o600);
    try { await file.writeFile(bytes, "utf8"); await file.sync(); }
    finally { await file.close(); }
  }
  return Object.freeze({ transport, snapshot, writeObservation });
}
