import { writeFile } from "node:fs/promises";
import { startManagedReferenceHost } from "./managed-reference-host";
void (async () => {
  const host = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "");
  process.send?.({type: "ready", runId: `managed-${host.report.run_id}`, sourceRevision: host.sourceRevision, profile: host.report.profile, frontendOrigin: host.frontendOrigin, token: host.token, fixtureWorkspaceId: host.fixtureWorkspaceId, workerCacheRoot: host.workerCacheRoot, ownedHostPid: host.ownedHostPid});
  let closing = false;
  process.on("message", message => {
    if ((message as {type?: string})?.type !== "shutdown" || closing) return;
    closing = true;
    void host.stop().then(() => {process.send?.({type: "closed"}, () => process.disconnect?.());}).catch(() => {process.exitCode=1; process.disconnect?.();});
  });
})().catch(async error => {
  // Ignored private diagnostic only. No child output or credentials are sent to
  // the Playwright reporter, which emits a fixed startup-failed diagnostic.
  await writeFile(".local-codex/approved-controls/managed-reference-private-startup.log", error instanceof Error ? error.stack ?? error.name : "Managed startup failed.");
  process.exitCode = 1; process.disconnect?.();
});
