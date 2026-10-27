# Desktop dataset preparation

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This feature presents the shared four-step preparation workflow and the desktop
host client. The [shared output editor](../../../../../../modules/ui/shared/data-management/README.md)
owns bounded visual shapes and protected training purposes. The desktop hook
preserves explicit model and output choices in named training settings; loading a
set is an explicit user action. Resetting output fields does not clear a saved
explicit constrained-output preference.

Source loading has separate loading, ready and failed states. Retry a failed
source list directly in Add data. Empty-source guidance is shown only after a
successful read. Workspace/client changes and newer requests retire older replies;
only a current successful source list can enable preparation. Read failures use
fixed safe text and do not replace task progress or a saved result.

The shared recommendation hook keeps an untouched choice stable for the selected
model. Runtime polling cannot rewrite an explicit checked choice to unchecked.
If current readiness is missing, submission stops before model preparation or
task dispatch. A user can explicitly turn off the checked option while the
output shape is valid; invalid shapes keep the control disabled. Existing live
memory checks and notification-center shortfall messages remain authoritative.

Keep each control accessible by its visible title. A label that contains a help
button before a select does not reliably name that select. The Saved training
settings select therefore has an explicit accessible name that matches its
visible title. Functional tests must exercise that name, saving, reset, loading
and restoration after reload. An unnamed control must not be hidden by switching
the regression to a CSS-only selector.

The focused packaged-host qualification uses a declared synthetic runtime and
isolated profile. It tests real UI and saved-setting behavior without model
inference or accuracy reruns. See the
[host controls qualification](../../../../../../dev-tools/scripts/qualification/visual-composer/structured-output-qualification.md)
for commands, evidence and scope limits. Renderer reload does not prove native
process restart or physical model readiness.

Scanned-PDF text recognition is an explicit, off-by-default choice under
Document-structure sections. The shared control requires a language and PDF-only
selection. Named settings and workspace drafts preserve that choice; missing legacy
fields start off. Malformed flags stop submission. Changing the method or training
goal turns recognition off; incompatible source changes retain a visible checked
choice and require correction. Version reuse verifies currently available PDF
sources before restoring OCR settings. Execution still uses authoritative host
admission and private byte bindings. Show actual reader counts and explain that
text-character checks are not OCR accuracy. Local component tests do not qualify
complete native host/package delivery.

Session recovery retains running tasks and datasets that still need approval.
Successful approval, a completed task result, or confirmed discard removes only
the matching request in that workspace. A newer request or another workspace's
recovery record stays intact. Completed tasks must not reopen the saved-result
view when the user returns to preparation after a reload.

Scanned-PDF recognition accepts at most 16 pages per PDF. Split a longer PDF
into smaller source files before using recognition. A version replay must retain
the exact structure-aware/layout/Markdown settings and a compatible training goal;
an explicit saved plan cannot bypass those checks.

The desktop task client maps the closed `ocr_unavailable` and
`ocr_input_invalid` failure codes to fixed language/source corrective messages.
It preserves the validated normalization stage while discarding raw worker
messages and details. Unknown codes keep the generic safe failure message;
private runtime paths, prompts and supplier exceptions are never UI copy.

Desktop Browser offers saved-version settings reuse through a page-owned one-use
request. Preparation waits for the exact current sources, then uses the complete
validated restore hook and acknowledges from the resulting form commit. Queueing
or navigation is not success. Captured input/change/click events, navigation,
workspace changes, source failure, unmount and replacement retire older requests.
The request is bounded frozen data, is never persisted and is released after
settlement. Retired callbacks and active tasks or reviews cannot replace settings.
Provider choices reset to local-only; approval and provider authority are never
restored, and reuse never starts preparation or publication. Thin reuse and actual
host, provider, native and scale qualification remain pending.
Saved-version source lookup uses the existing workspace-authorized artifact-detail
read. It does not assume the ordinary first250 browse rows are a complete list.
Capture the bounded immutable request, retain observed duplicate/conflict denials,
then resolve at most 100 canonical keys sequentially within 15 seconds. The returned
key supplies the source ID. Reject missing legacy IDs with no authoritative key
binding. Keep looked-up options private until the complete settings/request
roundtrip passes. Check the current page request and committed frame before and
after each await and before setters. Merge options and settings together; announce
success only after the consumer form commit. Timeout stops later reads without
claiming to cancel IPC. No task/model/provider is started by reuse.

Global Dataset Notifications use fixed progress copy and the same closed failure
code messages as the task client. Validated numeric memory-shortfall facts survive
the client mapping so the notification can state the amount to free. Raw runtime
messages, unknown details and invalid counts do not enter notification history.
Committed workspace/client retirement and exact shared-listener cleanup reject
late updates. A bounded terminal identity cache refuses duplicate start replay.
Focused rendered/client tests preserve review, cancellation, overflow warnings and
measured memory guidance; actual hosts and final combined testing stay separate.

## Goal, material and method test matrix

The focused cross-app Dataset matrix drives the mounted desktop form through
visible panel toggles and its labeled controls. It checks every currently
supported goal/source-format pair, compatible dataset merging, task-specific
labels and annotations, fixed/topic/structure division and explicit model choices
for assisted image metadata. Invalid active settings require correction; inactive
settings must not enter the outgoing recipe. Desktop output choices remain
Parquet, JSONL, JSON and CSV. The browser has its own smaller exposed format set.

Finite source/settings/inventory and unavailable-runtime fixtures keep this test
local. The preparation client captures a command then refuses it before task
admission. No decoding, inference, accuracy test, OCR, provider action or durable
save occurs. Actual transport/runtime, installed-host and final qualification
remain separate. No product behavior is changed by adding this matrix.
