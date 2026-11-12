import { useLayoutEffect, useRef, useState } from "react";
import { MAX_ASSET_PLACEMENTS_PER_COMPOSITION } from "../../../contracts/asset";
import { SYSTEM_FORM_ROUTE_OPERATORS } from "../../../contracts/system-builder";
import type {
  PublishedSystemForm,
  PublishedSystemFormSubmitInput,
  SystemFormField,
  SystemFormSubmitResult,
  SystemFormValue,
} from "../../../contracts/system-builder";
import { validateSystemFormValue } from "../../../application/services/system-builder/system-form-rules.service";
import { ModalDialog } from "../components/ModalDialog";
import { SystemFormJourney } from "./SystemFormPreview";
import type { SystemPublishedFormClient } from "./SystemPublishedFormClient";

interface Props {
  readonly workspaceId: string;
  readonly releaseId: string;
  readonly client: SystemPublishedFormClient;
  readonly onClose: () => void;
}

type SendState = "editing" | "sending" | "retry" | "pending" | "complete" | "denied" | "invalid";
// Both published-form transports and the submission use case enforce this bound.
const MAX_SUBMISSION_TEXT_CHARACTERS = 32_768;

export function SystemPublishedFormDialog(props: Props) {
  const { workspaceId, releaseId, client } = props;
  const [scope, setScope] = useState({ workspaceId, releaseId, client, key: 0 });
  if (scope.workspaceId !== workspaceId || scope.releaseId !== releaseId || scope.client !== client) {
    setScope({ workspaceId, releaseId, client, key: scope.key + 1 });
    return null;
  }
  return <PublishedFormSession key={scope.key} {...props} />;
}

function PublishedFormSession({ workspaceId, releaseId, client, onClose }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [forms, setForms] = useState<readonly PublishedSystemForm[]>();
  const [readFailed, setReadFailed] = useState(false);
  const [selected, setSelected] = useState("");
  const [sendState, setSendState] = useState<SendState>("editing");
  const [answerLimitExceeded, setAnswerLimitExceeded] = useState(false);
  const sending = useRef(false);
  const session = useRef<object | undefined>(undefined);
  const staged = useRef<PublishedSystemFormSubmitInput | undefined>(undefined);
  const resultStatus = useRef<HTMLParagraphElement>(null);
  const answerLimitStatus = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const owner = {};
    session.current = owner;
    setForms(undefined);
    setReadFailed(false);
    void Promise.resolve().then(() => session.current === owner ? client.list({ workspaceId, releaseId }) : undefined)
      .then((result) => {
        if (session.current !== owner || !result) return;
        if (!result.ok || !isFormList(result.value)) { setReadFailed(true); return; }
        setForms(result.value);
        setSelected(result.value.length === 1 ? result.value[0]!.id : "");
      }).catch(() => { if (session.current === owner) setReadFailed(true); });
    return () => { if (session.current === owner) session.current = undefined; };
  }, [workspaceId, releaseId, client, attempt]);

  useLayoutEffect(() => {
    if (sendState !== "editing" && sendState !== "sending") resultStatus.current?.focus();
  }, [sendState]);
  useLayoutEffect(() => {
    if (answerLimitExceeded) answerLimitStatus.current?.focus();
  }, [answerLimitExceeded]);

  const form = forms?.find((entry) => entry.id === selected);

  async function send() {
    const owner = session.current;
    const input = staged.current;
    if (!owner || !input || sending.current) return;
    sending.current = true;
    setSendState("sending");
    let outcome: SystemFormSubmitResult | undefined;
    try {
      const result = await client.submit(input);
      if (result.ok && isSubmissionResult(result.value)) outcome = result.value;
    } catch {
      // A missing reply does not prove whether a record was created.
    } finally {
      sending.current = false;
    }
    if (session.current !== owner) return;
    if (outcome?.status === "completed" || outcome?.status === "already-recorded") {
      staged.current = undefined;
      setSendState("complete");
    } else if (outcome?.status === "denied" || outcome?.status === "invalid") {
      staged.current = undefined;
      setSendState(outcome.status);
    } else setSendState(outcome?.status === "pending" ? "pending" : "retry");
  }

  function finish(answers: ReadonlyMap<string, SystemFormValue>) {
    if (!form || staged.current || sending.current) return;
    let textLength = 0;
    for (const answer of answers.values()) {
      if (typeof answer === "string") textLength += answer.length;
    }
    if (textLength > MAX_SUBMISSION_TEXT_CHARACTERS) {
      setAnswerLimitExceeded(true);
      answerLimitStatus.current?.focus();
      return;
    }
    setAnswerLimitExceeded(false);
    const submissionId = globalThis.crypto?.randomUUID?.();
    if (!submissionId) { setSendState("invalid"); return; }
    staged.current = { workspaceId, releaseId, formId: form.id, submissionId, answers: Object.fromEntries(answers) };
    void send();
  }

  return (
    <ModalDialog open title="Published forms" closeLabel="Close published forms" onClose={onClose}>
      <div className="ui-stack ui-stack--md">
        {readFailed ? <>
          <p role="status">Could not open forms for this published build.</p>
          <button type="button" className="ui-button ui-button--outline" onClick={() => setAttempt((current) => current + 1)}>Try again</button>
        </> : !forms ? <p role="status">Loading forms…</p>
          : !forms.length ? <p role="status">No forms are available for this published build.</p>
            : sendState === "editing" ? <>
              {forms.length > 1 ? (
                <label className="ui-stack ui-stack--sm">
                  Form to complete
                  <select value={selected} onChange={(event) => {
                    setSelected(event.currentTarget.value);
                    setAnswerLimitExceeded(false);
                  }}>
                    <option value="">Choose a form</option>
                    {forms.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                </label>
              ) : null}
              {form ? <>
                <h3>{form.title}</h3>
                {answerLimitExceeded ? <p role="status" tabIndex={-1} ref={answerLimitStatus}>
                  Shorten your answers to 32,768 characters total, then submit again.
                </p> : null}
                <SystemFormJourney key={form.id} form={form} finalLabel="Submit form" onFinish={finish} />
              </> : null}
            </> : sendState === "sending" ? <>
              <p role="status">Submitting form…</p>
              <p>You can close this window. Closing it does not stop a submission already sent.</p>
            </>
              : sendState === "complete" ? <p role="status" tabIndex={-1} ref={resultStatus}>Your form was submitted.</p>
                : sendState === "denied" ? <p role="status" tabIndex={-1} ref={resultStatus}>You do not have permission to submit this form.</p>
                  : sendState === "invalid" ? <p role="status" tabIndex={-1} ref={resultStatus}>Could not submit this form. Close it and try again.</p>
                    : <>
                      <p role="status" tabIndex={-1} ref={resultStatus}>{sendState === "pending" ? "Your submission is still pending." : "The host did not confirm your submission."}</p>
                      <p>Retry to check the same submission.</p>
                      <button type="button" className="ui-button ui-button--outline" onClick={() => void send()}>Retry submission</button>
                    </>}
      </div>
    </ModalDialog>
  );
}

function isFormList(value: unknown): value is readonly PublishedSystemForm[] {
  const record = (item: unknown): item is Record<string, unknown> =>
    Boolean(item && typeof item === "object" && !Array.isArray(item));
  const text = (item: unknown, max: number): item is string => typeof item === "string" && item.length > 0 && item.length <= max;
  const finite = (item: unknown): boolean => item === undefined || typeof item === "number" && Number.isFinite(item);
  const kinds = new Set(["text", "multiline", "choice", "number", "date-time", "checkbox"]);
  if (!Array.isArray(value) || value.length > MAX_ASSET_PLACEMENTS_PER_COMPOSITION) return false;
  const formIds = new Set<string>();
  let totalAssets = value.length;
  return Array.from(value).every((entry: unknown) => {
    if (!record(entry) || !text(entry.id, 160) || formIds.has(entry.id) || !text(entry.title, 200) ||
        !Array.isArray(entry.steps) || !entry.steps.length || entry.steps.length > 32) return false;
    const formId = entry.id;
    formIds.add(formId);
    totalAssets += entry.steps.length;
    if (totalAssets > MAX_ASSET_PLACEMENTS_PER_COMPOSITION) return false;
    const pageIds = new Set<string>();
    for (const page of entry.steps) {
      if (!record(page) || !text(page.id, 160) || page.id === formId || pageIds.has(page.id)) return false;
      pageIds.add(page.id);
    }
    const destination = (item: unknown) => item === formId || typeof item === "string" && pageIds.has(item);
    const fieldsInForm = new Set<string>();
    const graph = new Map<string, string[]>();
    const validPages = entry.steps.every((page: unknown) => {
      if (!record(page) || typeof page.id !== "string" || !text(page.label, 200) || !destination(page.defaultDestinationId) ||
          !Array.isArray(page.fields) || page.fields.length > 64 || !Array.isArray(page.conditions) || page.conditions.length > 8) return false;
      const pageFields = new Set<string>();
      if (!Array.from(page.fields).every((field: unknown) => {
        if (++totalAssets > MAX_ASSET_PLACEMENTS_PER_COMPOSITION || fieldsInForm.size >= 64 || !record(field) || !text(field.id, 160) || fieldsInForm.has(field.id) ||
            !text(field.label, 200) || typeof field.helpText !== "string" || field.helpText.length > 1000 ||
            typeof field.kind !== "string" || !kinds.has(field.kind) || typeof field.required !== "boolean" ||
            !finite(field.min) || !finite(field.max) ||
            (field.earliest !== undefined && !text(field.earliest, 16)) ||
            (field.latest !== undefined && !text(field.latest, 16)) ||
            (field.dateKind !== "date" && field.dateKind !== "time" && field.dateKind !== "date-time") ||
            (field.choicePresentation !== undefined && (field.choicePresentation !== "radio" || field.kind !== "choice")) ||
            !Array.isArray(field.options) || field.options.length > 32 || !validFieldBounds(field as unknown as SystemFormField)) return false;
        pageFields.add(field.id);
        fieldsInForm.add(field.id);
        if (field.kind === "choice" ? field.options.length === 0 : field.options.length > 0) return false;
        const optionValues = new Set<string>();
        return Array.from(field.options).every((option: unknown) => {
          if (!record(option) || !text(option.label, 200) || !text(option.value, 200) || optionValues.has(option.value)) return false;
          optionValues.add(option.value);
          return true;
        });
      })) return false;
      const destinations = [String(page.defaultDestinationId)];
      let priority = -1;
      for (const route of page.conditions as unknown[]) {
        if (!record(route) || route.fromStepId !== page.id || !destination(route.destinationId) ||
            typeof route.priority !== "number" || !Number.isInteger(route.priority) || route.priority <= priority || route.priority > 7) return false;
        const when = route.when;
        if (!record(when) || typeof when.fieldId !== "string" || !pageFields.has(when.fieldId) ||
            !SYSTEM_FORM_ROUTE_OPERATORS.some((operator) => operator === when.operator) ||
            !(typeof when.value === "boolean" || typeof when.value === "number" && Number.isFinite(when.value) ||
              text(when.value, 200))) return false;
        priority = route.priority;
        destinations.push(String(route.destinationId));
      }
      graph.set(page.id, destinations);
      return true;
    });
    if (!validPages) return false;
    const open = new Set<string>();
    const visited = new Set<string>();
    function visit(id: string): boolean {
      if (id === formId || visited.has(id)) return true;
      const edges = graph.get(id);
      if (!edges || open.has(id)) return false;
      open.add(id);
      if (!edges.every(visit)) return false;
      open.delete(id);
      visited.add(id);
      return true;
    }
    return visit(entry.steps[0].id) && visited.size === graph.size;
  });
}

function validFieldBounds(field: SystemFormField): boolean {
  const { kind, min, max, earliest, latest } = field;
  if (min !== undefined && max !== undefined && min > max) return false;
  if (kind === "text" || kind === "multiline") {
    if (min !== undefined && (!Number.isInteger(min) || min < 0 || min > 4000)) return false;
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 4000)) return false;
  } else if (kind !== "number" && (min !== undefined || max !== undefined)) return false;
  if (kind !== "date-time") return earliest === undefined && latest === undefined;
  const date = { ...field, required: false };
  return [earliest, latest].every((bound) => bound === undefined || !validateSystemFormValue(date, bound));
}

function isSubmissionResult(value: unknown): value is SystemFormSubmitResult {
  if (!value || typeof value !== "object" || !("status" in value)) return false;
  if (value.status === "completed" || value.status === "already-recorded" || value.status === "pending") {
    return "receiptId" in value && typeof value.receiptId === "string" && value.receiptId.length > 0;
  }
  return value.status === "unavailable" || value.status === "denied" || value.status === "invalid";
}
