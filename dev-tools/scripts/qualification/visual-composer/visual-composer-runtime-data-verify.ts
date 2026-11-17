import assert from "node:assert/strict";
import { createStructuredSystemBuildRepository } from "../../../../modules/adapters/persistence/system-build";
import { normalizeSystemReleaseId } from "../../../../modules/contracts/system-build";
import { readRuntimeReleasePair, assertRuntimeReleaseBinding, assertRuntimeDataIsolation, type RuntimeDataObservation } from "./runtime-lifecycle-oracles";

import { createLocalConversationRepositoryAdapters } from "../../../../modules/adapters/persistence/conversations";
import { createLocalExecutionRunRepositoryAdapters } from "../../../../modules/adapters/persistence/execution-runs";
import { createStructuredSystemRuntimeInstanceRepository } from "../../../../modules/adapters/persistence/system-deployment";
import {
  createLocalSqliteSystemRuntimeDatabaseAdapter,
  createSystemRuntimeRepositorySessionFactory,
} from "../../../../modules/adapters/persistence/system-runtime";
import {
  openLocalSqliteDatabase,
  resolveLocalSqliteDatabasePolicy,
} from "../../../../modules/adapters/persistence/sqlite";
import { readLocalIdentityProfile } from "../../../../modules/adapters/security/local-identity";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";

async function main(): Promise<void> {
  const dataRoot = process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT?.trim();
  const workspaceValue =
    process.env.VISUAL_COMPOSER_QUALIFICATION_WORKSPACE_ID?.trim();
  if (!dataRoot || !workspaceValue) {
    throw new Error("Runtime data qualification context is unavailable.");
  }
  const workspaceId = createWorkspaceId(workspaceValue);
  const encodedContexts = process.env.VISUAL_COMPOSER_QUALIFICATION_RELEASE_CONTEXTS;
  if (!encodedContexts || Buffer.byteLength(encodedContexts) > 4096) {
    throw new Error("Runtime release qualification context is unavailable.");
  }
  const contexts = readRuntimeReleasePair(JSON.parse(encodedContexts));
  assert.ok(contexts.every(context => context.workspaceId === workspaceId));
  const database = await openLocalSqliteDatabase({
    policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: dataRoot }),
  });
  const runtimeDatabases = createLocalSqliteSystemRuntimeDatabaseAdapter({
    dataRootDirectory: dataRoot,
  });
  try {
    const identity = await readLocalIdentityProfile(database.documents);
    assert.ok(identity, "Qualification identity is unavailable.");
    const organizationDocuments = database.documents.forOrganization(
      identity.organizationId,
    );
    const runtimeInstances =
      await createStructuredSystemRuntimeInstanceRepository(
        organizationDocuments,
      ).listRuntimeInstances(identity.organizationId, workspaceId);
    assert.equal(runtimeInstances.length, 2);
    const releaseRepository = createStructuredSystemBuildRepository(organizationDocuments);
    const observations: RuntimeDataObservation[] = [];
    for (const context of contexts) {
      const matches = runtimeInstances.filter(instance => instance.releaseId === context.releaseId);
      assert.equal(matches.length, 1);
      const instance = matches[0]!;
      assert.equal(instance.status, "retained");
      assert.equal(instance.organizationId, identity.organizationId);
      assert.equal(instance.workspaceId, workspaceId);
      const release = await releaseRepository.readRelease(workspaceId, normalizeSystemReleaseId(context.releaseId));
      assert.ok(release, "The exact qualification release is unavailable.");
      assertRuntimeReleaseBinding(context, release);
      const runtimeSession = await createSystemRuntimeRepositorySessionFactory(runtimeDatabases).open(instance);
      try {
        const sessions = await runtimeSession.conversationSessionRepository.listConversationSessions({ workspaceId });
        assert.equal(sessions.sessions.length, 1);
        const sessionId = sessions.sessions[0]!.id;
        const messages = await runtimeSession.conversationMessageRepository.listConversationMessagesBySession(workspaceId, sessionId);
        const responses = await runtimeSession.assistantResponseRepository.listAssistantResponsesBySession(workspaceId, sessionId);
        const execution = await runtimeSession.executionRunRepository.listExecutionRuns({ workspaceId });
        observations.push({
          context, runtimeInstanceId: instance.runtimeInstanceId,
          dataBindingId: instance.dataBindingId, sessionId,
          userMessages: messages.map(message => message.text),
          assistantResponses: responses.map(response => response.text),
          executionCount: execution.runs.length,
        });
      } finally {
        await runtimeSession.close();
      }
    }
    assertRuntimeDataIsolation(contexts, observations);

    const controlConversations = createLocalConversationRepositoryAdapters({
      rootDir: ".",
      documents: organizationDocuments,
    });
    const controlExecution = createLocalExecutionRunRepositoryAdapters({
      rootDir: ".",
      documents: organizationDocuments,
    });
    assert.equal(
      (
        await controlConversations.conversationSessionRepository.listConversationSessions(
          {
            workspaceId,
          },
        )
      ).sessions.length,
      0,
    );
    assert.equal(
      (
        await controlExecution.executionRunRepository.listExecutionRuns({
          workspaceId,
        })
      ).runs.length,
      0,
    );
  } finally {
    await runtimeDatabases.closeAll();
    database.close();
  }
}

void main().catch(() => {
  process.stderr.write("Isolated runtime data qualification failed.\n");
  process.exitCode = 1;
});
