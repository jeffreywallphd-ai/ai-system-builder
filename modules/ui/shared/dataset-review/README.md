# Dataset review

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Shared review navigation retains the selected row, explicit decisions and bounded
host-provided pages. A pending empty page shows loading; a failed page shows its
sanitized error inside the dialog. Only a successfully read empty page shows
that there is nothing to review. Dataset Preparation supplies its scoped read
error to this component; closing and reopening uses its existing retry path.
These actionable dialog states are classified as contextual-only in the shared
notification inventory and remain covered by its exhaustive migration guard.

## Saved-row workspace checks

The saved-row workspace allows one edit or reject action at a time, including
repeated clicks before the busy state renders. Typed fields and local selection
are disabled during that accepted action. Empty numeric input is invalid; it
does not silently become zero. Failed saves retain the draft for correction.

Lists, pages and action replies belong to their committed workspace and service.
Changing either or unmounting retires their UI updates. An accepted backend write
can finish, but cannot refresh or notify a retired view. Page identity must match
the selected artifact, version and page. Storage exceptions at the save boundary
use a fixed public retry message. Storage ownership and compensation are unchanged.

The composed test mounts this workspace through real clients, registered IPC or
owned HTTP, application, SQLite and filesystem. A finite registry returns golden
Parquet outcomes through the production staging adapter. Separate model-free
Python tests execute the real codec against the golden data. The provided source
is setup data stored through the artifact port, not an upload UI claim. These
checks do not qualify an actual sidecar, installed window, model/OCR/provider,
native process or parent roadmap. Accepted model/OCR results remain closed.
