> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Normalization, serialization, sink and fallback-console failures cannot fail the
owning operation. The fallback diagnostic uses static safe copy and does not
include the rejected payload, event identity or raw exception.
