import { useEffect, useMemo, useState } from "react";
import type {
  SystemDataAuditEntry,
  SystemDataFormDescriptor,
  SystemDataRecord,
  SystemDataRecordPage,
  SystemDataResult,
  SystemDataValues,
} from "../../../contracts/system-data";
import type { SystemRelease } from "../../../contracts/system-build";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import type { SystemBuildClient } from "./SystemBuildReleaseWorkflow";

export interface SystemDataClient {
  describe(input: {
    workspaceId: string;
    releaseId: string;
    entityType: string;
  }): Promise<SystemDataResult<SystemDataFormDescriptor>>;
  create(input: {
    workspaceId: string;
    releaseId: string;
    entityType: string;
    recordId: string;
    values: SystemDataValues;
  }): Promise<SystemDataResult<SystemDataRecord>>;
  read(input: {
    workspaceId: string;
    releaseId: string;
    entityType: string;
    recordId: string;
  }): Promise<SystemDataResult<SystemDataRecord>>;
  update(input: {
    workspaceId: string;
    releaseId: string;
    entityType: string;
    recordId: string;
    expectedRevision: number;
    values: SystemDataValues;
  }): Promise<SystemDataResult<SystemDataRecord>>;
  list(input: {
    workspaceId: string;
    releaseId: string;
    entityType: string;
    limit?: number;
    offset?: number;
  }): Promise<SystemDataResult<SystemDataRecordPage>>;
  listAudit(input: {
    workspaceId: string;
    releaseId: string;
    entityType: string;
    limit?: number;
  }): Promise<SystemDataResult<readonly SystemDataAuditEntry[]>>;
}

export interface SystemDataRunTestProps {
  readonly workspaceId: string;
  readonly client: SystemDataClient;
  readonly buildClient: Pick<SystemBuildClient, "listReleases">;
}

export function SystemDataRunTest({
  workspaceId,
  client,
  buildClient,
}: SystemDataRunTestProps) {
  const [releases, setReleases] = useState<readonly SystemRelease[]>([]);
  const [releaseId, setReleaseId] = useState("");
  const [entityType, setEntityType] = useState("service-request");
  const [descriptor, setDescriptor] = useState<SystemDataFormDescriptor>();
  const [records, setRecords] = useState<readonly SystemDataRecord[]>([]);
  const [audit, setAudit] = useState<readonly SystemDataAuditEntry[]>([]);
  const [selected, setSelected] = useState<SystemDataRecord>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string }>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    setDescriptor(undefined);
    setSelected(undefined);
    setRecords([]);
    setAudit([]);
    void buildClient.listReleases({ workspaceId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError({ message: result.error.message });
        return;
      }
      setReleases(result.value);
      setReleaseId(String(result.value[0]?.releaseId ?? ""));
    });
    return () => {
      active = false;
    };
  }, [buildClient, workspaceId]);

  const context = useMemo(
    () => ({ workspaceId, releaseId, entityType: entityType.trim() }),
    [entityType, releaseId, workspaceId],
  );

  async function refresh(nextDescriptor = descriptor) {
    if (!nextDescriptor) return;
    const [recordResult, auditResult] = await Promise.all([
      client.list({
        ...context,
        limit: nextDescriptor.maximumPageSize,
        offset: 0,
      }),
      client.listAudit({ ...context, limit: 100 }),
    ]);
    if (recordResult.ok) setRecords(recordResult.value.items);
    else
      setError({
        message: recordResult.error.message,
        field: recordResult.error.field,
      });
    if (auditResult.ok) setAudit(auditResult.value);
  }

  async function loadRelease() {
    if (!releaseId || !entityType.trim()) {
      setError({
        message: "Choose an approved release and enter its entity type.",
      });
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setSelected(undefined);
    const result = await client.describe(context);
    if (result.ok) {
      setDescriptor(result.value);
      setValues(
        Object.fromEntries(
          result.value.fields.map((field) => [field.name, ""]),
        ),
      );
      await refresh(result.value);
      setNotice(
        "Verified release schema loaded. Every write is validated and authorized by the host.",
      );
    } else
      setError({ message: result.error.message, field: result.error.field });
    setBusy(false);
  }

  async function submit() {
    if (!descriptor) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const payload = toValues(descriptor, values);
    const result = selected
      ? await client.update({
          ...context,
          recordId: selected.recordId,
          expectedRevision: selected.revision,
          values: payload,
        })
      : await client.create({
          ...context,
          recordId: createRecordId(),
          values: payload,
        });
    if (result.ok) {
      setSelected(result.value);
      setValues(toEditableValues(descriptor, result.value));
      await refresh();
      setNotice(
        selected
          ? "Record updated with an optimistic revision check."
          : "Record created with an atomic audit entry.",
      );
    } else
      setError({ message: result.error.message, field: result.error.field });
    setBusy(false);
  }

  async function selectRecord(record: SystemDataRecord) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await client.read({ ...context, recordId: record.recordId });
    if (result.ok && descriptor) {
      setSelected(result.value);
      setValues(toEditableValues(descriptor, result.value));
    } else if (!result.ok)
      setError({ message: result.error.message, field: result.error.field });
    setBusy(false);
  }

  function startCreate() {
    if (!descriptor) return;
    setSelected(undefined);
    setValues(
      Object.fromEntries(descriptor.fields.map((field) => [field.name, ""])),
    );
    setError(undefined);
    setNotice("Creating a new record.");
  }

  return (
    <section
      className="ui-panel ui-panel--sectioned system-data-runtime"
      aria-labelledby="system-data-runtime-title"
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--blue">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="dataset" />
          </span>
          <div>
            <h2 id="system-data-runtime-title" className="ui-panel__title">
              Secured data-entry release
            </h2>
            <p className="ui-text-muted">
              Run the verified schema, authorization, masking, optimistic
              persistence, and audit behavior of an approved release.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--md">
        {error ? (
          <div
            className="ui-status ui-status--error"
            role="alert"
            tabIndex={-1}
          >
            <strong>Review the highlighted input.</strong>
            <span>{error.message}</span>
          </div>
        ) : null}
        {notice ? (
          <p className="ui-status ui-status--success" role="status">
            {notice}
          </p>
        ) : null}
        <div className="ui-workflow__field-grid">
          <label>
            Approved release
            <select
              value={releaseId}
              onChange={(event) => setReleaseId(event.currentTarget.value)}
              disabled={busy}
            >
              <option value="">Choose a release</option>
              {releases.map((release) => (
                <option
                  key={String(release.releaseId)}
                  value={String(release.releaseId)}
                >
                  {release.releaseId}
                </option>
              ))}
            </select>
          </label>
          <label>
            Entity type
            <input
              value={entityType}
              onChange={(event) => setEntityType(event.currentTarget.value)}
              disabled={busy}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void loadRelease()}
          disabled={busy || !releaseId || !entityType.trim()}
        >
          <ApplicationIcon name="play" />
          <span>{busy ? "Loading..." : "Load verified form"}</span>
        </button>
        {descriptor ? (
          <>
            <div className="system-data-runtime__layout">
              <form
                className="ui-stack ui-stack--sm"
                aria-labelledby="system-data-form-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
                noValidate
              >
                <div className="ui-inline-actions">
                  <h3 id="system-data-form-title">{descriptor.title}</h3>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    onClick={startCreate}
                    disabled={busy}
                  >
                    New record
                  </button>
                </div>
                {descriptor.fields.map((field) => {
                  const inputId = `system-data-field-${field.name}`;
                  const invalid = error?.field === field.name;
                  return (
                    <label key={field.name} htmlFor={inputId}>
                      {field.label}
                      {field.required ? " *" : ""}
                      {field.type === "enum" ? (
                        <select
                          id={inputId}
                          required={field.required}
                          aria-invalid={invalid || undefined}
                          value={values[field.name] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [field.name]: event.currentTarget.value,
                            }))
                          }
                        >
                          <option value="">
                            Choose {field.label.toLowerCase()}
                          </option>
                          {field.enumValues?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={inputId}
                          type={
                            field.type === "number"
                              ? "number"
                              : field.type === "date"
                                ? "date"
                                : "text"
                          }
                          required={field.required}
                          min={field.minimum}
                          max={field.maximum}
                          maxLength={field.maximumLength}
                          aria-invalid={invalid || undefined}
                          value={values[field.name] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [field.name]: event.currentTarget.value,
                            }))
                          }
                        />
                      )}
                      {invalid ? (
                        <span className="ui-status--error">
                          {error.message}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
                <button type="submit" disabled={busy}>
                  <ApplicationIcon name="save" />
                  <span>{selected ? "Update record" : "Create record"}</span>
                </button>
              </form>
              <section aria-labelledby="system-data-records-title">
                <h3 id="system-data-records-title">Records</h3>
                {records.length ? (
                  <div className="system-data-runtime__table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Record</th>
                          {descriptor.fields.map((field) => (
                            <th key={field.name} scope="col">
                              {field.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record) => (
                          <tr key={record.recordId}>
                            <th scope="row">
                              <button
                                type="button"
                                className="ui-button--tertiary"
                                onClick={() => void selectRecord(record)}
                              >
                                {record.recordId}
                              </button>
                            </th>
                            {descriptor.fields.map((field) => (
                              <td key={field.name}>
                                {displayValue(record.values[field.name])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    compact
                    title="No records yet"
                    description="Create the first record with the verified release form."
                    icon="dataset"
                  />
                )}
              </section>
            </div>
            <section aria-labelledby="system-data-audit-title">
              <h3 id="system-data-audit-title">Safe audit evidence</h3>
              {audit.length ? (
                <ul>
                  {audit.map((entry) => (
                    <li key={entry.auditId}>
                      <strong>
                        {entry.action} - {entry.outcome}
                      </strong>
                      <span>
                        {entry.actorId} at {entry.occurredAt}
                      </span>
                      {entry.changedFields.length ? (
                        <small>Fields: {entry.changedFields.join(", ")}</small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ui-text-muted">
                  No audit entries are available to this principal.
                </p>
              )}
            </section>
          </>
        ) : (
          <EmptyState
            compact
            title="Choose an approved release"
            description="Only immutable releases with a complete supported data-entry manifest can run."
            icon="security"
          />
        )}
      </div>
    </section>
  );
}

function toValues(
  descriptor: SystemDataFormDescriptor,
  values: Readonly<Record<string, string>>,
): SystemDataValues {
  return Object.fromEntries(
    descriptor.fields.map((field) => {
      const value = values[field.name] ?? "";
      return [
        field.name,
        field.type === "number" && value !== "" ? Number(value) : value,
      ];
    }),
  );
}
function toEditableValues(
  descriptor: SystemDataFormDescriptor,
  record: SystemDataRecord,
): Record<string, string> {
  return Object.fromEntries(
    descriptor.fields.map((field) => [
      field.name,
      record.values[field.name] === undefined
        ? ""
        : String(record.values[field.name]),
    ]),
  );
}
function displayValue(value: unknown): string {
  return value === undefined
    ? "Masked"
    : value === null || value === ""
      ? "-"
      : String(value);
}
function createRecordId(): string {
  const value =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `record:${value}`;
}
