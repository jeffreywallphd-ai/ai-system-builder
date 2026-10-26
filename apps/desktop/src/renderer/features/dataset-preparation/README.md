# Desktop dataset preparation

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This feature presents the shared four-step preparation workflow and the desktop
host client. The [shared output editor](../../../../../../modules/ui/shared/data-management/README.md)
owns bounded visual shapes and protected training purposes. The desktop hook
preserves explicit model and output choices in named training settings; loading a
set is an explicit user action. Resetting output fields does not clear a saved
explicit constrained-output preference.

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
