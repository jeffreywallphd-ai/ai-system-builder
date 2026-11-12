import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { SystemFormValue } from "../../../contracts/system-builder";
import {
  evaluateSystemForm, resolveSystemFormDestination, validateSystemFormValue,
  type CompiledSystemForm, type SystemFormField,
} from "../../../application/services/system-builder/system-form-rules.service";
import { ModalDialog } from "../components/ModalDialog";

export function SystemFormPreview({ form, hasConfiguredAction = false, onClose }: {
  readonly form: CompiledSystemForm; readonly hasConfiguredAction?: boolean; readonly onClose: () => void;
}) {
  const [included, setIncluded] = useState<readonly string[]>();
  const [restarted, setRestarted] = useState(false);
  const completion = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { if (included) completion.current?.focus(); }, [included]);
  return (
    <ModalDialog open title={`Preview: ${form.title}`} closeLabel="Close preview" onClose={onClose}>
      <div className="ui-stack ui-stack--md">
        <p>Use sample answers to check your form. Preview does not save answers or run actions.</p>
        {included ? (
          <div role="status" className="ui-stack ui-stack--sm">
            <h3 ref={completion} tabIndex={-1}>Preview complete</h3>
            <p>{included.length ? `Answers included: ${included.join(", ")}.` : "No answers included."}</p>
            {hasConfiguredAction ? <p>Configured action: Create Record. Preview did not run the action.</p> : null}
            <button className="ui-button ui-button--outline" type="button" onClick={() => {
              setRestarted(true);
              setIncluded(undefined);
            }}>Start again</button>
          </div>
        ) : <SystemFormJourney form={form} focusOnMount={restarted} finalLabel="Finish preview" onFinish={(answers) => setIncluded(
          form.steps.flatMap((step) => step.fields.filter((field) => answers.has(field.id)).map((field) => field.label)),
        )} />}
      </div>
    </ModalDialog>
  );
}

export function SystemFormJourney({ form, focusOnMount = false, finalLabel, onFinish }: {
  readonly form: CompiledSystemForm;
  readonly focusOnMount?: boolean;
  readonly finalLabel: string;
  readonly onFinish: (answers: ReadonlyMap<string, SystemFormValue>) => void;
}) {
  const [path, setPath] = useState<readonly string[]>([form.steps[0]!.id]);
  const [position, setPosition] = useState(0);
  const [answers, setAnswers] = useState<ReadonlyMap<string, SystemFormValue>>(() => new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const badInput = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const prefix = useId();
  const fieldIds = useMemo(() => new Map(form.steps.flatMap((entry) => entry.fields)
    .map((field, index) => [field.id, `${prefix}-field-${index}`])), [form, prefix]);
  const step = form.steps.find((entry) => entry.id === path[position])!;
  const focusedStep = useRef(focusOnMount ? undefined : step.id);
  const destination = resolveSystemFormDestination(step, answers);
  const fieldId = (id: string) => fieldIds.get(id)!;
  useLayoutEffect(() => {
    if (focusedStep.current !== step.id) heading.current?.focus();
    focusedStep.current = step.id;
  }, [step.id]);

  function change(field: SystemFormField, value: SystemFormValue | undefined, invalid = false) {
    if (invalid) badInput.current.add(field.id);
    else badInput.current.delete(field.id);
    setAnswers((current) => {
      const next = new Map(current);
      if (value === undefined || value === "") next.delete(field.id);
      else next.set(field.id, value);
      return next;
    });
    if (errors.has(field.id)) setErrors((current) => {
      const next = new Map(current);
      next.delete(field.id);
      return next;
    });
  }

  function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = new Map<string, string>();
    for (const field of step.fields) {
      const control = event.currentTarget.ownerDocument.getElementById(fieldId(field.id)) as HTMLInputElement | null;
      const error = badInput.current.has(field.id) || control?.validity?.badInput
        ? field.kind === "number" ? "Enter a number." : "Enter a valid date or time."
        : validateSystemFormValue(field, answers.get(field.id));
      if (error) invalid.set(field.id, error);
    }
    setErrors(invalid);
    if (invalid.size) {
      event.currentTarget.ownerDocument.getElementById(fieldId(invalid.keys().next().value!))?.focus();
      return;
    }
    if (destination === form.id) {
      const outcome = evaluateSystemForm(form, answers);
      if (outcome.ok) onFinish(outcome.submitted);
      else if (outcome.fieldId) setErrors(new Map([[outcome.fieldId, outcome.message]]));
      return;
    }
    if (path[position + 1] !== destination) {
      const retired = new Set(path.slice(position + 1));
      if (retired.size) {
        const retiredFields = form.steps.filter((previous) => retired.has(previous.id)).flatMap((previous) => previous.fields);
        for (const field of retiredFields) badInput.current.delete(field.id);
        setAnswers((current) => {
          const next = new Map(current);
          for (const field of retiredFields) next.delete(field.id);
          return next;
        });
      }
      setPath([...path.slice(0, position + 1), destination]);
    }
    setPosition(position + 1);
  }

  return (
    <form noValidate className="ui-stack ui-stack--md" onSubmit={advance} aria-labelledby={`${prefix}-step`}>
      <h3 ref={heading} id={`${prefix}-step`} tabIndex={-1}>{step.label}</h3>
      {step.fields.map((field) => <AnswerControl key={field.id} id={fieldId(field.id)} field={field}
        value={answers.get(field.id)} error={errors.get(field.id)} onChange={(value, invalid) => change(field, value, invalid)} />)}
      <div className="ui-workflow__actions">
        {position > 0 ? <button className="ui-button ui-button--outline" type="button" onClick={() => {
          setErrors(new Map());
          setPosition(position - 1);
        }}>Back</button> : null}
        <button className="ui-button" type="submit">{destination === form.id ? finalLabel : "Next page"}</button>
      </div>
    </form>
  );
}

function AnswerControl({ field, id, value, error, onChange }: {
  readonly field: SystemFormField; readonly id: string; readonly value: SystemFormValue | undefined;
  readonly error: string | undefined; readonly onChange: (value: SystemFormValue | undefined, invalid?: boolean) => void;
}) {
  const description = [field.helpText ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  const props = { id, required: field.required, "aria-invalid": error ? true as const : undefined,
    "aria-describedby": description || undefined };
  const text = typeof value === "string" ? value : "";
  const inputType = field.kind === "date-time" ? (field.dateKind === "date-time" ? "datetime-local" : field.dateKind) : field.kind === "number" ? "number" : "text";
  const hasNativeParser = field.kind === "number" || field.kind === "date-time";
  function reportInput(control: HTMLInputElement) {
    const value = field.kind === "number" ? control.value ? control.valueAsNumber : undefined : control.value;
    onChange(value, control.validity.badInput);
  }
  if (field.kind === "choice" && field.choicePresentation === "radio") {
    return (
      <fieldset className="ui-stack ui-stack--sm" aria-describedby={props["aria-describedby"]}>
        <legend>{field.label}{field.required ? " (required)" : ""}</legend>
        {field.options.map((option, index) => (
          <label key={option.value}>
            <input {...props} id={index ? `${id}-option-${index}` : id} name={id} type="radio"
              value={option.value} checked={text === option.value} onChange={() => onChange(option.value)} />
            {" "}{option.label}
          </label>
        ))}
        {!field.required ? (
          <button className="ui-button ui-button--outline" type="button" disabled={!text}
            aria-label={`Clear selection for ${field.label}`} onClick={(event) => {
              onChange(undefined);
              event.currentTarget.ownerDocument.getElementById(id)?.focus();
            }}>
            Clear selection
          </button>
        ) : null}
        {field.helpText ? <span id={`${id}-help`}>{field.helpText}</span> : null}
        {error ? <span id={`${id}-error`} role="alert">{error}</span> : null}
      </fieldset>
    );
  }
  return (
    <div className="ui-stack ui-stack--sm">
      <label htmlFor={id}>{field.label}{field.required ? " (required)" : ""}</label>
      {field.kind === "multiline" ? <textarea {...props} value={text} maxLength={field.max} onChange={(event) => onChange(event.currentTarget.value)} />
        : field.kind === "choice" ? <select {...props} value={text} onChange={(event) => onChange(event.currentTarget.value)}>
          <option value="">Select an option</option>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
          : field.kind === "checkbox" ? <input {...props} type="checkbox" checked={value === true} onChange={(event) => onChange(event.currentTarget.checked)} />
            : <input {...props} type={inputType} value={typeof value === "number" ? value : text}
              step={field.kind === "number" ? "any" : undefined}
              maxLength={field.kind === "text" ? field.max : undefined}
              onInput={hasNativeParser ? (event) => reportInput(event.currentTarget) : undefined}
              onChange={(event) => {
                if (!hasNativeParser || event.nativeEvent.type !== "input") reportInput(event.currentTarget);
              }} />}
      {field.helpText ? <span id={`${id}-help`}>{field.helpText}</span> : null}
      {error ? <span id={`${id}-error`} role="alert">{error}</span> : null}
    </div>
  );
}
