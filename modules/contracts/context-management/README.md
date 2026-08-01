# Context Management Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This family defines the host-neutral Context product language for RAG databases,
Markdown context packs, source inspection, persisted chunk lineage, bounded manual
context, generation settings, review previews, saved artifact references, and
identifier-only Data Management handoffs.

Manual pack contents are validated as Markdown and preserved exactly. A leading
hash without a following space is valid plain Markdown text, not an invalid
heading. Source-derived packs explicitly select Standard or Strict cleaning and
either No Summarization or an installed local model with a maximum line count.

The contracts deliberately exclude local paths, raw vectors, provider payloads,
prompts, runtime internals, and storage roots. A source is already chunked only
after application-side inspection validates persisted records against the exact
source digest and lineage. Generic prepared status, filenames, route flags, and
renderer claims are never authority.
