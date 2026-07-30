import assert from "node:assert/strict";

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

const EXPECTED_USER_MESSAGES = [
  "Button qualification turn",
  "Keyboard qualification turn",
];

async function main(): Promise<void> {
  const dataRoot = process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT?.trim();
  const workspaceValue =
    process.env.VISUAL_COMPOSER_QUALIFICATION_WORKSPACE_ID?.trim();
  if (!dataRoot || !workspaceValue) {
    throw new Error("Runtime data qualification context is unavailable.");
  }
  const workspaceId = createWorkspaceId(workspaceValue);
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
    assert.equal(runtimeInstances.length, 1);
    assert.equal(runtimeInstances[0]?.status, "retained");

    const runtimeSession = await createSystemRuntimeRepositorySessionFactory(
      runtimeDatabases,
    ).open(runtimeInstances[0]!);
    try {
      const sessions =
        await runtimeSession.conversationSessionRepository.listConversationSessions(
          {
            workspaceId,
          },
        );
      assert.equal(sessions.sessions.length, 1);
      const sessionId = sessions.sessions[0]!.id;
      const messages =
        await runtimeSession.conversationMessageRepository.listConversationMessagesBySession(
          workspaceId,
          sessionId,
        );
      const responses =
        await runtimeSession.assistantResponseRepository.listAssistantResponsesBySession(
          workspaceId,
          sessionId,
        );
      assert.deepEqual(
        messages.map((message) => message.text),
        EXPECTED_USER_MESSAGES,
      );
      assert.deepEqual(
        responses.map((response) => response.text),
        EXPECTED_USER_MESSAGES.map(
          (message) => `Controlled response to: ${message}`,
        ),
      );
      assert.equal(
        (
          await runtimeSession.executionRunRepository.listExecutionRuns({
            workspaceId,
          })
        ).runs.length,
        EXPECTED_USER_MESSAGES.length,
      );
    } finally {
      await runtimeSession.close();
    }

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
