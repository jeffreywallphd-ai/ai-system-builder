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
