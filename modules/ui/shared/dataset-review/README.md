# Dataset review

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Shared review navigation retains the selected row, explicit decisions and bounded
host-provided pages. A pending empty page shows loading; a failed page shows its
sanitized error inside the dialog. Only a successfully read empty page shows
that there is nothing to review. Dataset Preparation supplies its scoped read
error to this component; closing and reopening uses its existing retry path.
These actionable dialog states are classified as contextual-only in the shared
notification inventory and remain covered by its exhaustive migration guard.
