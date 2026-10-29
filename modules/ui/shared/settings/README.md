# Shared Settings Fields

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

These React components render supported application setting values for desktop
and thin-client callers. They depend on public settings contracts and shared
glossary UI. They contain no host client, storage, provider or runtime access.
Desktop's previous component paths are compatible reexports.

Labels bind to their actual input or select with stable React IDs. Interactive
help is outside each label and keeps keyboard/Escape behavior. Clear remains
available for configured string, select, boolean, folder and object values.
Secret drafts use password inputs, never prefill a stored value, and clear only
after their current callback returns true. A newer draft survives an older result.
Blank or nonfinite number drafts cannot accidentally save zero.

Hosts own loading, mutation permission, readback and notification outcomes.
Thin client omits folder selection; folder text addresses the server's setting.
Model-default fields edit the existing object contract and do not resolve,
download, train or load models. No new backend capability follows from reuse.
