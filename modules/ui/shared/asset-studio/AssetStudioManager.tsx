import { useEffect, useState } from "react";

import type { AssetImplementationDraft } from "../../../contracts/asset-implementation";
import type {
  AssetStudioPatchProposal,
  AssetStudioProposalView,
  AssetStudioResult,
  AssetStudioWorkflowRecord,
} from "../../../contracts/asset-studio";
import type {
  AssetStudioAssetDraftListView,
  AssetStudioAssetDraftRecord,
  AssetStudioAssetDraftView,
  CreateAssetStudioAssetDraftCommand,
  ListAssetStudioAssetDraftsQuery,
  ReadAssetStudioAssetDraftQuery,
  TransitionAssetStudioAssetDraftCommand,
  UpdateAssetStudioAssetDraftCommand,
} from "../../../contracts/asset-studio";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";

export interface AssetStudioClient {
  start(input: {
    workspaceId: string;
    definitionRef: {
      kind: "asset-definition-version";
      id: string;
      version: string;
    };
    displayName: string;
  }): Promise<AssetStudioResult<AssetImplementationDraft>>;
  propose(input: {
    workflowId: string;
    workspaceId: string;
    implementationDraftId: string;
    definitionRef: {
      kind: "asset-definition-version";
      id: string;
      version: string;
    };
    mode: "manual" | "coding-model";
    intent: string;
    manualProposal?: AssetStudioPatchProposal;
    context: readonly [];
    allowedDependencies: readonly string[];
    allowedCapabilities: readonly string[];
  }): Promise<AssetStudioResult<AssetStudioProposalView>>;
  review(input: {
    workspaceId: string;
    workflowId: string;
    expectedRevision: number;
    decision: "approve" | "reject";
    approvedDependencies: readonly string[];
    approvedCapabilities: readonly string[];
  }): Promise<AssetStudioResult<AssetStudioWorkflowRecord>>;
  list(
    workspaceId: string,
  ): Promise<AssetStudioResult<readonly AssetStudioWorkflowRecord[]>>;
  createAssetDraft(
    input: Omit<CreateAssetStudioAssetDraftCommand, "actorId">,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>>;
  updateAssetDraft(
    input: Omit<UpdateAssetStudioAssetDraftCommand, "actorId">,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>>;
  readAssetDraft(
    input: ReadAssetStudioAssetDraftQuery,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftView>>;
  listAssetDrafts(
    input: ListAssetStudioAssetDraftsQuery,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftListView>>;
  reviewAssetDraft(
    input: Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>>;
  publishAssetDraft(
    input: Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>>;
  abandonAssetDraft(
    input: Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>>;
}

export function AssetStudioManager({
  workspaceId,
  client,
}: {
  readonly workspaceId: string;
  readonly client: AssetStudioClient;
}) {
  const [definitionId, setDefinitionId] = useState("");
  const [definitionVersion, setDefinitionVersion] = useState("1.0.0");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"manual" | "coding-model">("manual");
  const [intent, setIntent] = useState("");
  const [filePath, setFilePath] = useState("src/index.ts");
  const [source, setSource] = useState(
    "export const asset = { render: () => null };\n",
  );
  const [draft, setDraft] = useState<AssetImplementationDraft>();
  const [proposal, setProposal] = useState<AssetStudioProposalView>();
  const [workflows, setWorkflows] = useState<
    readonly AssetStudioWorkflowRecord[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    setDraft(undefined);
    setProposal(undefined);
    setError(undefined);
    void client.list(workspaceId).then((result) => {
      if (!active) return;
      if (result.ok) setWorkflows(result.value);
      else setError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [client, workspaceId]);

  const definitionRef = {
    kind: "asset-definition-version" as const,
    id: definitionId.trim(),
    version: definitionVersion.trim(),
  };
  async function start() {
    if (!definitionRef.id || !definitionRef.version || !displayName.trim()) {
      setError("Definition ID, version, and implementation name are required.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await client.start({
      workspaceId,
      definitionRef,
      displayName,
    });
    if (result.ok) {
      setDraft(result.value);
      setNotice(
        "Implementation workspace created. Source is not published or executable.",
      );
    } else setError(result.error.message);
    setBusy(false);
  }
  async function generateProposal() {
    if (!draft || !intent.trim()) {
      setError(
        "Start an implementation and describe the intended behavior first.",
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await client.propose({
      workflowId: `studio-workflow.${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      workspaceId,
      implementationDraftId: String(draft.draftId),
      definitionRef,
      mode,
      intent,
      ...(mode === "manual"
        ? {
            manualProposal: {
              summary: intent,
              plan: [
                "Review the proposed implementation",
                "Validate contracts and source policy",
              ],
              files: [{ path: filePath, content: source }],
              dependencies: [],
              requestedCapabilities: [],
            },
          }
        : {}),
      context: [],
      allowedDependencies: [],
      allowedCapabilities: [],
    });
    if (result.ok) {
      setProposal(result.value);
      setNotice("Proposal created. Review every file before approval.");
    } else setError(result.error.message);
    setBusy(false);
  }
  async function review(decision: "approve" | "reject") {
    if (!proposal) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await client.review({
      workspaceId,
      workflowId: proposal.record.workflowId,
      expectedRevision: proposal.record.revision,
      decision,
      approvedDependencies: proposal.proposal.dependencies,
      approvedCapabilities: proposal.proposal.requestedCapabilities,
    });
    if (result.ok) {
      setProposal(undefined);
      setWorkflows((current) => [
        result.value,
        ...current.filter(
          (item) => item.workflowId !== result.value.workflowId,
        ),
      ]);
      setNotice(
        decision === "approve"
          ? "Source approved and stored as an immutable snapshot. Build and publication remain separate gates."
          : "Proposal rejected without changing source.",
      );
    } else setError(result.error.message);
    setBusy(false);
  }

  return (
    <section
      className="ui-panel ui-panel--sectioned asset-studio"
      aria-labelledby="asset-studio-title"
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--violet">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="assets" />
          </span>
          <div>
            <h2 id="asset-studio-title" className="ui-panel__title">
              Asset Studio
            </h2>
            <p className="ui-text-muted">
              Create reviewed implementation source for an exact asset
              definition.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack">
        {error ? (
          <p className="ui-status ui-status--error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="ui-status ui-status--success" role="status">
            {notice}
          </p>
        ) : null}
        <WorkflowSequence ariaLabel="Asset Studio authoring steps">
          <WorkflowStep
            title="Choose the contract"
            description="Implementation source is always tied to an exact, existing definition version."
            active={!draft}
          >
            <div className="ui-workflow__field-grid">
              <label>
                Definition ID
                <input
                  value={definitionId}
                  onChange={(event) =>
                    setDefinitionId(event.currentTarget.value)
                  }
                  placeholder="workspace.asset-id"
                />
              </label>
              <label>
                Definition version
                <input
                  value={definitionVersion}
                  onChange={(event) =>
                    setDefinitionVersion(event.currentTarget.value)
                  }
                />
              </label>
              <label>
                Implementation name
                <input
                  value={displayName}
                  onChange={(event) =>
                    setDisplayName(event.currentTarget.value)
                  }
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busy || Boolean(draft)}
              onClick={() => void start()}
            >
              <ApplicationIcon name="add" />
              <span>Start implementation</span>
            </button>
          </WorkflowStep>
          <WorkflowStep
            title="Plan and propose source"
            description="Manual and coding-model paths produce the same bounded patch proposal. Neither path can publish or execute code."
            active={Boolean(draft) && !proposal}
          >
            <div className="ui-workflow__field-grid">
              <label>
                Authoring method
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.currentTarget.value as typeof mode)
                  }
                >
                  <option value="manual">Manual TypeScript</option>
                  <option value="coding-model">Coding model</option>
                </select>
              </label>
              <label>
                Implementation intent
                <textarea
                  value={intent}
                  onChange={(event) => setIntent(event.currentTarget.value)}
                />
              </label>
            </div>
            {mode === "manual" ? (
              <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
                <label>
                  Source file
                  <input
                    value={filePath}
                    onChange={(event) => setFilePath(event.currentTarget.value)}
                  />
                </label>
                <label>
                  TypeScript or declarative source
                  <textarea
                    className="asset-studio__source"
                    spellCheck={false}
                    value={source}
                    onChange={(event) => setSource(event.currentTarget.value)}
                  />
                </label>
              </div>
            ) : (
              <p className="ui-status">
                A configured coding-model adapter receives bounded contract
                context only. If none is configured, the request fails safely
                without changing source.
              </p>
            )}
            <button
              type="button"
              disabled={busy || !draft}
              onClick={() => void generateProposal()}
            >
              <ApplicationIcon name="play" />
              <span>
                {mode === "manual" ? "Create review" : "Ask coding model"}
              </span>
            </button>
          </WorkflowStep>
          <WorkflowStep
            title="Review and approve"
            description="Approval is invalidated if the proposal revision, dependencies, or capabilities change."
            active={Boolean(proposal)}
          >
            {proposal ? (
              <div className="ui-stack ui-stack--sm">
                <strong>{proposal.proposal.summary}</strong>
                <ol>
                  {proposal.proposal.plan.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {proposal.proposal.files.map((file) => (
                  <details key={file.path} open>
                    <summary>{file.path}</summary>
                    <pre className="asset-studio__diff">
                      <code>{file.content}</code>
                    </pre>
                  </details>
                ))}
                <div className="ui-workflow__actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void review("approve")}
                  >
                    <ApplicationIcon name="save" />
                    <span>Approve source snapshot</span>
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    disabled={busy}
                    onClick={() => void review("reject")}
                  >
                    <ApplicationIcon name="close" />
                    <span>Reject proposal</span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="ui-text-muted">
                Create a proposal to review its plan, files, dependencies, and
                capabilities.
              </p>
            )}
          </WorkflowStep>
          <WorkflowStep
            title="Build, test, and publish"
            description="Only an approved immutable snapshot can enter isolated build, contract-test, security, preview, and publication gates."
          >
            <p className="ui-status">
              Build and release evidence appears here after the isolated builder
              accepts this snapshot. Missing sandbox support remains a blocking,
              truthful state.
            </p>
          </WorkflowStep>
        </WorkflowSequence>
        <section className="asset-studio__history">
          <h3>Authoring history</h3>
          {workflows.length ? (
            <ul>
              {workflows.map((workflow) => (
                <li key={workflow.workflowId}>
                  <strong>{workflow.status}</strong> · {workflow.fileCount}{" "}
                  files · {workflow.mode}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No implementation proposals"
              description="Start with an exact asset definition to create reviewed source."
              icon="assets"
              compact
            />
          )}
        </section>
      </div>
    </section>
  );
}
