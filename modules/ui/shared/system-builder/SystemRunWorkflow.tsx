import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  InvokeSystemRunWorkflowCommand,
  ListSystemRunWorkflowProfilesQuery,
  PrepareSystemRunWorkflowQuery,
  SystemRunWorkflowAction,
  SystemRunWorkflowArtifactItem,
  SystemRunWorkflowField,
  SystemRunWorkflowProfileSummary,
  SystemRunWorkflowResult,
  SystemRunWorkflowResultBlock,
  SystemRunWorkflowSnapshot,
  SystemRunWorkflowValue,
  SystemRunWorkflowValues,
} from "../../../contracts/system-run-workflow";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { LoadingSpinner } from "../components/LoadingSpinner";

export interface SystemRunWorkflowClient {
  listProfiles(
    query: ListSystemRunWorkflowProfilesQuery,
  ): Promise<
    SystemRunWorkflowResult<readonly SystemRunWorkflowProfileSummary[]>
  >;
  prepare(
    query: PrepareSystemRunWorkflowQuery,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>>;
  invoke(
    command: InvokeSystemRunWorkflowCommand,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>>;
}

export interface SystemRunWorkflowProps {
  readonly workspaceId: string;
  readonly client: SystemRunWorkflowClient;
}

type EditableValue = string | boolean;
type EditableValues = Readonly<Record<string, EditableValue>>;
type BusyOperation = "profiles" | "prepare" | "invoke";

interface WorkflowError {
  readonly message: string;
  readonly field?: string;
}

export function SystemRunWorkflow({
  workspaceId,
  client,
}: SystemRunWorkflowProps) {
  const instanceId = useId();
  const requestGeneration = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const actionHeadingRef = useRef<HTMLHeadingElement>(null);
  const [profiles, setProfiles] = useState<
    readonly SystemRunWorkflowProfileSummary[]
  >([]);
  const [selectedProfileKey, setSelectedProfileKey] = useState("");
  const [snapshot, setSnapshot] = useState<SystemRunWorkflowSnapshot>();
  const [selectedActionId, setSelectedActionId] = useState("");
  const [values, setValues] = useState<EditableValues>({});
  const [reviewActionId, setReviewActionId] = useState("");
  const [confirmationAccepted, setConfirmationAccepted] = useState(false);
  const [busy, setBusy] = useState<BusyOperation>();
  const [error, setError] = useState<WorkflowError>();
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setProfiles([]);
    setSelectedProfileKey("");
    clearPreparedState();
    setBusy("profiles");
    setError(undefined);
    setNotice("");
    void client.listProfiles({ workspaceId }).then((result) => {
      if (generation !== requestGeneration.current) return;
      setBusy(undefined);
      if (result.ok) {
        setProfiles(result.value);
        return;
      }
      setError({
        message: result.error.message,
        field: result.error.field,
      });
    });
    return () => {
      requestGeneration.current += 1;
    };
    // clearPreparedState intentionally captures only state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceId]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const selectedProfile = useMemo(
    () =>
      profiles.find(
        (profile) => profileKey(profile) === selectedProfileKey,
      ),
    [profiles, selectedProfileKey],
  );
  const selectedAction = useMemo(
    () =>
      snapshot?.actions.find(
        (action) => action.actionId === selectedActionId,
      ),
    [selectedActionId, snapshot],
  );

  function clearPreparedState() {
    setSnapshot(undefined);
    setSelectedActionId("");
    setValues({});
    setReviewActionId("");
    setConfirmationAccepted(false);
  }

  function selectProfile(key: string) {
    requestGeneration.current += 1;
    setSelectedProfileKey(key);
    clearPreparedState();
    setBusy(undefined);
    setError(undefined);
    setNotice("");
  }

  async function prepareSelectedProfile() {
    if (!selectedProfile || selectedProfile.availability !== "available")
      return;
    const generation = ++requestGeneration.current;
    setBusy("prepare");
    setError(undefined);
    setNotice("");
    clearPreparedState();
    const result = await client.prepare({
      workspaceId,
      profileId: selectedProfile.profileId,
      source: selectedProfile.source,
    });
    if (generation !== requestGeneration.current) return;
    setBusy(undefined);
    if (!result.ok) {
      setError({
        message: result.error.message,
        field: result.error.field,
      });
      return;
    }
    setSnapshot(result.value);
    setNotice(
      "Workflow details loaded. No system change or runtime action has occurred.",
    );
    queueMicrotask(() => actionHeadingRef.current?.focus());
  }

  function selectAction(actionId: string) {
    const action = snapshot?.actions.find(
      (candidate) => candidate.actionId === actionId,
    );
    setSelectedActionId(actionId);
    setValues(action ? initialValues(action) : {});
    setReviewActionId("");
    setConfirmationAccepted(false);
    setError(undefined);
    setNotice("");
  }

  async function beginAction() {
    if (!selectedAction) return;
    const mapped = mapValues(selectedAction, values);
    if (!mapped.ok) {
      setError({ message: mapped.message, field: mapped.field });
      return;
    }
    if (selectedAction.requiresConfirmation) {
      setReviewActionId(selectedAction.actionId);
      setConfirmationAccepted(false);
      setError(undefined);
      setNotice(
        "Review the exact source, action, and values before confirming.",
      );
      return;
    }
    await invokeSelectedAction(mapped.values);
  }

  async function confirmAction() {
    if (
      !selectedAction ||
      reviewActionId !== selectedAction.actionId ||
      !confirmationAccepted
    )
      return;
    const mapped = mapValues(selectedAction, values);
    if (!mapped.ok) {
      setError({ message: mapped.message, field: mapped.field });
      return;
    }
    await invokeSelectedAction(mapped.values);
  }

  async function invokeSelectedAction(mappedValues: SystemRunWorkflowValues) {
    if (!snapshot || !selectedAction) return;
    const generation = ++requestGeneration.current;
    setBusy("invoke");
    setError(undefined);
    setNotice("");
    const result = await client.invoke({
      workspaceId,
      profileId: snapshot.profile.profileId,
      source: snapshot.profile.source,
      actionId: selectedAction.actionId,
      operationId: createOperationId(),
      expectedSnapshotRevision: snapshot.snapshotRevision,
      values: mappedValues,
    });
    if (generation !== requestGeneration.current) return;
    setBusy(undefined);
    if (!result.ok) {
      setError({
        message: result.error.message,
        field: result.error.field,
      });
      return;
    }
    setSnapshot(result.value);
    setValues(initialValues(selectedAction));
    setReviewActionId("");
    setConfirmationAccepted(false);
    setNotice(`${selectedAction.label} completed.`);
  }

  const profileLoading = busy === "profiles";
  const workflowBusy = busy === "prepare" || busy === "invoke";

  return (
    <section
      className="ui-panel ui-panel--sectioned system-run-workflow"
      aria-labelledby={`${instanceId}-title`}
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--blue">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="play" />
          </span>
          <div>
            <h2 id={`${instanceId}-title`} className="ui-panel__title">
              Run &amp; Test
            </h2>
            <p className="ui-text-muted">
              Choose one verified system workflow, configure an available
              action, review any side effects, and inspect bounded results.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--md">
        {error ? (
          <div
            ref={errorRef}
            className="ui-status ui-status--error"
            role="alert"
            tabIndex={-1}
          >
            <strong>Unable to complete the workflow request.</strong>
            <span>{error.message}</span>
          </div>
        ) : null}
        {notice ? (
          <p className="ui-status ui-status--success" role="status">
            {notice}
          </p>
        ) : null}

        <div className="ui-workflow">
          <section
            className="ui-workflow__step"
            data-active={!snapshot || undefined}
            aria-labelledby={`${instanceId}-choose-title`}
          >
            <h3
              id={`${instanceId}-choose-title`}
              className="ui-workflow__step-title"
            >
              Choose a workflow
            </h3>
            <p className="ui-workflow__step-description ui-text-muted">
              Workflow summaries are read-only and come from exact approved
              releases or reviewed execution plans supported by this host.
            </p>
            {profileLoading ? (
              <LoadingSpinner label="Loading available system workflows" />
            ) : profiles.length ? (
              <>
                <label htmlFor={`${instanceId}-profile`}>
                  Available workflow
                  <select
                    id={`${instanceId}-profile`}
                    value={selectedProfileKey}
                    disabled={workflowBusy}
                    onChange={(event) =>
                      selectProfile(event.currentTarget.value)
                    }
                  >
                    <option value="">Choose a workflow</option>
                    {profiles.map((profile) => (
                      <option
                        key={profileKey(profile)}
                        value={profileKey(profile)}
                      >
                        {profile.title} - {profile.source.label}
                        {profile.availability === "blocked"
                          ? " (blocked)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedProfile ? (
                  <ProfileSummary profile={selectedProfile} />
                ) : null}
                <div className="ui-workflow__actions">
                  <button
                    type="button"
                    onClick={() => void prepareSelectedProfile()}
                    disabled={
                      workflowBusy ||
                      !selectedProfile ||
                      selectedProfile.availability !== "available"
                    }
                  >
                    <ApplicationIcon name="arrow-right" />
                    <span>
                      {busy === "prepare"
                        ? "Loading workflow..."
                        : "Open workflow"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    disabled={workflowBusy}
                    onClick={() => {
                      requestGeneration.current += 1;
                      setBusy("profiles");
                      setError(undefined);
                      setNotice("");
                      clearPreparedState();
                      const generation = requestGeneration.current;
                      void client
                        .listProfiles({ workspaceId })
                        .then((result) => {
                          if (generation !== requestGeneration.current) return;
                          setBusy(undefined);
                          if (result.ok) setProfiles(result.value);
                          else
                            setError({
                              message: result.error.message,
                              field: result.error.field,
                            });
                        });
                    }}
                  >
                    <ApplicationIcon name="refresh" />
                    Refresh list
                  </button>
                </div>
              </>
            ) : (
              <EmptyState
                compact
                title="No runnable workflows"
                description="Publish or review a supported system source, then refresh this list."
                icon="systems"
              />
            )}
          </section>

          <section
            className="ui-workflow__step"
            data-active={Boolean(snapshot) || undefined}
            aria-labelledby={`${instanceId}-action-title`}
          >
            <h3
              ref={actionHeadingRef}
              id={`${instanceId}-action-title`}
              className="ui-workflow__step-title"
              tabIndex={-1}
            >
              Configure an action
            </h3>
            <p className="ui-workflow__step-description ui-text-muted">
              Only actions projected by the selected exact workflow are
              available. Choosing or configuring an action does not run it.
            </p>
            {snapshot ? (
              <>
                <label htmlFor={`${instanceId}-action`}>
                  Action
                  <select
                    id={`${instanceId}-action`}
                    value={selectedActionId}
                    disabled={workflowBusy}
                    onChange={(event) =>
                      selectAction(event.currentTarget.value)
                    }
                  >
                    <option value="">Choose an action</option>
                    {snapshot.actions.map((action) => (
                      <option
                        key={action.actionId}
                        value={action.actionId}
                        disabled={!action.enabled}
                      >
                        {action.label}
                        {!action.enabled ? " (unavailable)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedAction ? (
                  <ActionConfiguration
                    action={selectedAction}
                    values={values}
                    errorField={error?.field}
                    disabled={workflowBusy}
                    onValueChange={(fieldId, value) => {
                      setValues((current) => ({
                        ...current,
                        [fieldId]: value,
                      }));
                      setReviewActionId("");
                      setConfirmationAccepted(false);
                      if (error?.field === fieldId) setError(undefined);
                    }}
                  />
                ) : (
                  <EmptyState
                    compact
                    title="Choose an action"
                    description="The selected workflow determines which read, change, and execution actions are available."
                    icon="play"
                  />
                )}
                {selectedAction ? (
                  <div className="ui-workflow__actions">
                    <button
                      type="button"
                      className={
                        selectedAction.emphasis === "danger"
                          ? "ui-button ui-button--destructive"
                          : "ui-button"
                      }
                      disabled={workflowBusy || !selectedAction.enabled}
                      onClick={() => void beginAction()}
                    >
                      <ApplicationIcon
                        name={
                          selectedAction.requiresConfirmation
                            ? "security"
                            : "play"
                        }
                      />
                      {selectedAction.requiresConfirmation
                        ? `Review ${selectedAction.label}`
                        : selectedAction.label}
                    </button>
                    {!selectedAction.enabled &&
                    selectedAction.disabledReason ? (
                      <span className="ui-text-muted">
                        {selectedAction.disabledReason}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                compact
                title="Open a workflow first"
                description="Only the selected workflow's action details are loaded."
                icon="security"
              />
            )}
          </section>

          <section
            className="ui-workflow__step"
            data-active={Boolean(reviewActionId) || undefined}
            aria-labelledby={`${instanceId}-review-title`}
          >
            <h3
              id={`${instanceId}-review-title`}
              className="ui-workflow__step-title"
            >
              Review and confirm
            </h3>
            <p className="ui-workflow__step-description ui-text-muted">
              Read actions run only when selected. Changes and execution also
              require the explicit confirmation below.
            </p>
            {selectedAction &&
            reviewActionId === selectedAction.actionId &&
            snapshot ? (
              <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
                <dl className="system-run-workflow__review">
                  <div>
                    <dt>Source</dt>
                    <dd>{snapshot.profile.source.label}</dd>
                  </div>
                  <div>
                    <dt>Workflow</dt>
                    <dd>{snapshot.profile.title}</dd>
                  </div>
                  <div>
                    <dt>Action</dt>
                    <dd>{selectedAction.label}</dd>
                  </div>
                  <div>
                    <dt>Effect</dt>
                    <dd>{actionIntentLabel(selectedAction.intent)}</dd>
                  </div>
                </dl>
                {selectedAction.fields.length ? (
                  <dl className="system-run-workflow__review-values">
                    {selectedAction.fields.map((field) => (
                      <div key={field.fieldId}>
                        <dt>{field.label}</dt>
                        <dd>
                          {field.sensitive || field.kind === "secret-reference"
                            ? valueIsPresent(values[field.fieldId])
                              ? "Configured (hidden)"
                              : "Not provided"
                            : displayEditableValue(values[field.fieldId])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <label className="ui-workflow__checkbox-row">
                  <input
                    type="checkbox"
                    checked={confirmationAccepted}
                    onChange={(event) =>
                      setConfirmationAccepted(event.currentTarget.checked)
                    }
                  />
                  <span>
                    I confirm this {actionIntentLabel(selectedAction.intent)}{" "}
                    action against the exact source shown above.
                  </span>
                </label>
                <div className="ui-workflow__actions">
                  <button
                    type="button"
                    className={
                      selectedAction.emphasis === "danger"
                        ? "ui-button ui-button--destructive"
                        : "ui-button"
                    }
                    disabled={workflowBusy || !confirmationAccepted}
                    onClick={() => void confirmAction()}
                  >
                    <ApplicationIcon name="play" />
                    {busy === "invoke"
                      ? "Working..."
                      : `Confirm ${selectedAction.label}`}
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    disabled={workflowBusy}
                    onClick={() => {
                      setReviewActionId("");
                      setConfirmationAccepted(false);
                      setNotice("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                title="No confirmation pending"
                description="Select an available action. Read actions do not require a second confirmation."
                icon="security"
              />
            )}
          </section>

          <section
            className="ui-workflow__step"
            data-active={Boolean(snapshot?.blocks.length) || undefined}
            aria-labelledby={`${instanceId}-results-title`}
          >
            <h3
              id={`${instanceId}-results-title`}
              className="ui-workflow__step-title"
            >
              Results and history
            </h3>
            <p className="ui-workflow__step-description ui-text-muted">
              Results are bounded, sanitized projections. Audit and history
              remain owned by their original system capability.
            </p>
            {busy === "invoke" ? (
              <LoadingSpinner label="Running selected system workflow action" />
            ) : snapshot?.blocks.length ? (
              <div
                className="system-run-workflow__results"
                aria-live="polite"
              >
                {snapshot.blocks.map((block) => (
                  <ResultBlock key={block.blockId} block={block} />
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="No results loaded"
                description="Open a workflow to read its current bounded status and history."
                icon="artifacts"
              />
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function ProfileSummary({
  profile,
}: {
  readonly profile: SystemRunWorkflowProfileSummary;
}) {
  return (
    <div className="ui-workflow__subpanel ui-stack ui-stack--xs">
      <div className="system-run-workflow__profile-heading">
        <div>
          <strong>{profile.title}</strong>
          <span className="ui-text-muted">{profile.description}</span>
        </div>
        <span
          className={`ui-badge ${
            profile.availability === "available"
              ? "ui-badge--success"
              : "ui-badge--warning"
          }`}
        >
          {profile.availability}
        </span>
      </div>
      <dl className="system-run-workflow__profile-meta">
        <div>
          <dt>Source</dt>
          <dd>{profile.source.label}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{profile.source.kind.replaceAll("-", " ")}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{profile.category}</dd>
        </div>
      </dl>
      {profile.blockers.length ? (
        <ul className="system-run-workflow__blockers">
          {profile.blockers.map((blocker) => (
            <li key={`${blocker.code}:${blocker.message}`}>
              {blocker.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionConfiguration({
  action,
  values,
  errorField,
  disabled,
  onValueChange,
}: {
  readonly action: SystemRunWorkflowAction;
  readonly values: EditableValues;
  readonly errorField?: string;
  readonly disabled: boolean;
  readonly onValueChange: (fieldId: string, value: EditableValue) => void;
}) {
  return (
    <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
      <div className="system-run-workflow__action-summary">
        <div>
          <strong>{action.label}</strong>
          <span className="ui-text-muted">{action.description}</span>
        </div>
        <span className="ui-badge">
          {actionIntentLabel(action.intent)}
        </span>
      </div>
      {action.fields.length ? (
        <div className="ui-workflow__field-grid">
          {action.fields.map((field) => (
            <WorkflowField
              key={field.fieldId}
              field={field}
              value={values[field.fieldId]}
              invalid={errorField === field.fieldId}
              disabled={disabled}
              onChange={(value) => onValueChange(field.fieldId, value)}
            />
          ))}
        </div>
      ) : (
        <p className="ui-text-muted">
          This action does not require additional values.
        </p>
      )}
    </div>
  );
}

function WorkflowField({
  field,
  value,
  invalid,
  disabled,
  onChange,
}: {
  readonly field: SystemRunWorkflowField;
  readonly value: EditableValue | undefined;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: EditableValue) => void;
}) {
  const fieldInstanceId = useId();
  const descriptionId = `${fieldInstanceId}-description`;
  if (field.kind === "boolean") {
    return (
      <label className="ui-workflow__checkbox-row">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>
          {field.label}
          {field.required ? " *" : ""}
          {field.description ? (
            <small id={descriptionId}>{field.description}</small>
          ) : null}
        </span>
      </label>
    );
  }

  const common = {
    required: field.required,
    disabled,
    "aria-invalid": invalid || undefined,
    "aria-describedby": field.description ? descriptionId : undefined,
  } as const;
  return (
    <label>
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.kind === "select" ? (
        <select
          {...common}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Choose {field.label.toLowerCase()}</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.kind === "multiline" ? (
        <textarea
          {...common}
          maxLength={field.maximumLength}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      ) : (
        <input
          {...common}
          type={
            field.kind === "integer" || field.kind === "number"
              ? "number"
              : "text"
          }
          inputMode={
            field.kind === "integer"
              ? "numeric"
              : field.kind === "number"
                ? "decimal"
                : undefined
          }
          min={field.minimum}
          max={field.maximum}
          step={field.kind === "integer" ? 1 : undefined}
          maxLength={
            field.kind === "text" || field.kind === "secret-reference"
              ? field.maximumLength
              : undefined
          }
          autoComplete={
            field.kind === "secret-reference" ? "off" : undefined
          }
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
      {field.description ? (
        <small id={descriptionId} className="ui-text-muted">
          {field.description}
        </small>
      ) : null}
    </label>
  );
}

function ResultBlock({
  block,
}: {
  readonly block: SystemRunWorkflowResultBlock;
}) {
  switch (block.kind) {
    case "notice":
      return (
        <article
          className={`ui-status ${noticeToneClass(block.tone)}`}
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          <p>{block.message}</p>
        </article>
      );
    case "status":
      return (
        <article
          className="system-run-workflow__block"
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          <p>
            <span className="ui-badge ui-badge--info">{block.status}</span>
          </p>
          {block.summary ? <p>{block.summary}</p> : null}
        </article>
      );
    case "key-value":
      return (
        <article
          className="system-run-workflow__block"
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          <dl className="system-run-workflow__key-values">
            {block.entries.map((entry) => (
              <div key={entry.key}>
                <dt>{entry.label}</dt>
                <dd>{displayScalar(entry.value)}</dd>
              </div>
            ))}
          </dl>
        </article>
      );
    case "table":
      return (
        <article
          className="system-run-workflow__block"
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          {block.rows.length ? (
            <div className="system-run-workflow__table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    {block.columns.map((column) => (
                      <th key={column.columnId} scope="col">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={row.rowId}>
                      {block.columns.map((column, index) =>
                        index === 0 ? (
                          <th key={column.columnId} scope="row">
                            {displayScalar(
                              row.values[column.columnId] ?? null,
                            )}
                          </th>
                        ) : (
                          <td key={column.columnId}>
                            {displayScalar(
                              row.values[column.columnId] ?? null,
                            )}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ui-text-muted">
              {block.emptyMessage ?? "No rows are available."}
            </p>
          )}
        </article>
      );
    case "transcript":
      return (
        <article
          className="system-run-workflow__block"
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          {block.entries.length ? (
            <ol className="system-run-workflow__transcript">
              {block.entries.map((entry) => (
                <li key={entry.entryId}>
                  <strong>{entry.role}</strong>
                  <p>{entry.text}</p>
                  {entry.occurredAt ? <time>{entry.occurredAt}</time> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="ui-text-muted">No transcript entries are available.</p>
          )}
        </article>
      );
    case "artifacts":
      return (
        <article
          className="system-run-workflow__block"
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          {block.items.length ? (
            <ul className="system-run-workflow__artifacts">
              {block.items.map((item) => (
                <ArtifactResultItem key={item.artifactRef} item={item} />
              ))}
            </ul>
          ) : (
            <p className="ui-text-muted">No artifacts are available.</p>
          )}
        </article>
      );
    case "audit":
      return (
        <article
          className="system-run-workflow__block"
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          {block.items.length ? (
            <ol className="system-run-workflow__audit">
              {block.items.map((item) => (
                <li key={item.entryId}>
                  <span
                    className={`ui-badge ${
                      item.outcome === "allowed"
                        ? "ui-badge--success"
                        : item.outcome === "denied"
                          ? "ui-badge--warning"
                          : "ui-badge--danger"
                    }`}
                  >
                    {item.outcome}
                  </span>
                  <div>
                    <strong>{item.action}</strong>
                    <p>{item.summary}</p>
                    <time>{item.occurredAt}</time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ui-text-muted">No audit entries are available.</p>
          )}
        </article>
      );
    case "diagnostics":
      return (
        <article
          className="system-run-workflow__block"
          aria-labelledby={`${block.blockId}-title`}
        >
          <h4 id={`${block.blockId}-title`}>{block.title}</h4>
          <ul className="system-run-workflow__diagnostics">
            {block.items.map((item) => (
              <li
                key={`${item.code}:${item.message}`}
                className={`ui-status ${
                  item.severity === "error"
                    ? "ui-status--error"
                    : item.severity === "warning"
                      ? "ui-status--warning"
                      : ""
                }`}
              >
                <strong>{item.code}</strong>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        </article>
      );
  }
}

function ArtifactResultItem({
  item,
}: {
  readonly item: SystemRunWorkflowArtifactItem;
}) {
  const [imageUrl, setImageUrl] = useState("");
  useEffect(() => {
    if (
      item.previewKind !== "image" ||
      !item.previewBytes?.length ||
      typeof URL.createObjectURL !== "function"
    ) {
      setImageUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(item.previewBytes)], {
        type: item.mediaType ?? "application/octet-stream",
      }),
    );
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.mediaType, item.previewBytes, item.previewKind]);

  return (
    <li>
      <strong>{item.label}</strong>
      {item.summary ? <p>{item.summary}</p> : null}
      {item.previewKind === "text" && item.previewText ? (
        <pre>{item.previewText}</pre>
      ) : null}
      {item.previewKind === "table" && item.previewTable ? (
        <div className="system-run-workflow__table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                {item.previewTable.columns.map((column, index) => (
                  <th key={`${column}:${index}`} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.previewTable.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, columnIndex) =>
                    columnIndex === 0 ? (
                      <th key={columnIndex} scope="row">
                        {value}
                      </th>
                    ) : (
                      <td key={columnIndex}>{value}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {imageUrl ? <img src={imageUrl} alt={item.label} /> : null}
      {item.previewStatus && item.previewStatus !== "ready" ? (
        <p className="ui-text-muted">
          Preview {item.previewStatus.replaceAll("-", " ")}.
        </p>
      ) : null}
      {item.truncated ? (
        <small className="ui-text-muted">Preview is truncated.</small>
      ) : null}
    </li>
  );
}

function profileKey(profile: SystemRunWorkflowProfileSummary): string {
  return [
    profile.profileId,
    profile.source.kind,
    profile.source.sourceId,
    profile.source.sourceDigest ?? "",
    profile.source.sourceRevision ?? "",
  ].join("|");
}

function initialValues(action: SystemRunWorkflowAction): EditableValues {
  return Object.fromEntries(
    action.fields.map((field) => [
      field.fieldId,
      field.kind === "boolean"
        ? field.defaultValue === true
        : field.defaultValue === undefined ||
            field.defaultValue === null
          ? ""
          : String(field.defaultValue),
    ]),
  );
}

function mapValues(
  action: SystemRunWorkflowAction,
  values: EditableValues,
):
  | { readonly ok: true; readonly values: SystemRunWorkflowValues }
  | {
      readonly ok: false;
      readonly message: string;
      readonly field: string;
    } {
  const mapped: Record<string, SystemRunWorkflowValue> = {};
  for (const field of action.fields) {
    const value = values[field.fieldId];
    if (field.kind === "boolean") {
      mapped[field.fieldId] = value === true;
      continue;
    }
    const text = typeof value === "string" ? value : "";
    if (field.required && !text.trim())
      return {
        ok: false,
        message: `${field.label} is required.`,
        field: field.fieldId,
      };
    if (
      field.maximumLength !== undefined &&
      text.length > field.maximumLength
    )
      return {
        ok: false,
        message: `${field.label} exceeds its maximum length.`,
        field: field.fieldId,
      };
    if (field.kind === "integer" || field.kind === "number") {
      if (!text.trim()) {
        mapped[field.fieldId] = null;
        continue;
      }
      const number = Number(text);
      if (
        !Number.isFinite(number) ||
        (field.kind === "integer" && !Number.isInteger(number))
      )
        return {
          ok: false,
          message: `${field.label} must be a valid ${
            field.kind === "integer" ? "whole number" : "number"
          }.`,
          field: field.fieldId,
        };
      if (field.minimum !== undefined && number < field.minimum)
        return {
          ok: false,
          message: `${field.label} must be at least ${field.minimum}.`,
          field: field.fieldId,
        };
      if (field.maximum !== undefined && number > field.maximum)
        return {
          ok: false,
          message: `${field.label} must be at most ${field.maximum}.`,
          field: field.fieldId,
        };
      mapped[field.fieldId] = number;
      continue;
    }
    mapped[field.fieldId] = text;
  }
  return { ok: true, values: mapped };
}

function actionIntentLabel(
  intent: SystemRunWorkflowAction["intent"],
): string {
  switch (intent) {
    case "read":
      return "Read only";
    case "mutate":
      return "Changes system data";
    case "execute":
      return "Starts or controls execution";
  }
}

function valueIsPresent(value: EditableValue | undefined): boolean {
  return value === true || (typeof value === "string" && value.length > 0);
}

function displayEditableValue(value: EditableValue | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return typeof value === "string" && value.length ? value : "Not provided";
}

function displayScalar(value: SystemRunWorkflowValue): string {
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function noticeToneClass(
  tone: Extract<SystemRunWorkflowResultBlock, { kind: "notice" }>["tone"],
): string {
  switch (tone) {
    case "success":
      return "ui-status--success";
    case "warning":
      return "ui-status--warning";
    case "danger":
      return "ui-status--error";
    default:
      return "";
  }
}

let operationSequence = 0;
function createOperationId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `workflow-${random}`;
  operationSequence += 1;
  return `workflow-${Date.now()}-${operationSequence}`;
}
