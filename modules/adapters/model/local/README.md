# Local model adapters

`createLocalTrainingModelFilesAdapter` reuses the same configured-root,
bounded-inventory inspection as Context. Its narrower training profile needs
nonempty `config.json`, unsharded `model.safetensors` and `tokenizer.json`.
Adapter roots and shard indexes remain unavailable. Context retains its existing
tokenizer choices and behavior. The shared helper captures roots before awaits.
Reserved adapter/shard names are refused for any occupied entry, including empty
directories or links; absence checks fail closed on IO errors.
The returned training layout reference is private and proves presence only;
weights/configuration validity, byte integrity, native custody, readiness,
resources, training compatibility and ModelRead permission are not established.
Neither factory installs, downloads, loads a model, writes or changes ownership.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`createLocalContextEmbeddingModelFilesAdapter` implements existing-file
inspection for a host-approved Context model. It reuses the bounded model file
lister and configured roots. It does not discover registry records, install,
download, load a model or write files. Explicit network references, outside-root
paths, truncated inventories and unsupported layouts remain unavailable.

The initial profile needs an existing directory with `config.json`, an
unsharded `model.safetensors` and tokenizer data. Presence is not proof of valid
weights or sufficient resources. The runtime still validates and loads safe
weights locally; it cannot fall back to pickle or a different cached alias.
The application rechecks the saved model witness and current actor authority.

These are cooperative file-containment checks. They do not prove native source
custody, physical volume type, immutable bytes or process memory bounds. They
grant no reveal/delete authority, change no ACLs and never adopt retained
offload data. Existing native authority and offload guards remain unchanged.


The shared ComfyUI checkpoint resolver creates synchronized cache files with
exclusive copy semantics. If a file appears after the initial cache lookup, it
preserves that file and tries the existing bounded suffix sequence. Other copy
errors are not retried. Existing cache-hit and model-selection behavior is
unchanged. This cooperative cache operation supplies no Native file identity,
immutable source, reservation or Headless execution authority.

The optional `reviewedStorage` configuration adds a private reviewed-copy session
to the existing generated-model adapter. Default callers retain the ordinary
copy method. Binding captures closed request, context, limits and original
control methods synchronously, without IO. The application must supply its
original named staging directory, exact reviewed hashes and separate Save
consent; no public request can select a directory through this capability.

The session copies only its safe, flat full-model or adapter inventory into one
exclusively fresh private leaf. It checks source and copied bytes, file identity,
finite payload/time limits and observed free disk space. Copies use at most
1 MiB buffers. The private leaf is outside ordinary cache-discovery naming.
Successful copying grants no Model registration, approval or readiness.

Keep the original write Promise through any outward timeout. A fence stops new
write work; it does not close an original read/write/open/close operation. Status
exposes actual pending operations and handles. Unknown IO stays unconfirmed.
Discard requires actual original IO closure and an independent application
decision that no committed or uncertain Model reference can use the copy. It
removes only its unchanged known files and empty owned leaf, never the source,
foreign additions or substituted data. This is ADR-0049 bounded-local storage:
the signed-in user and installed dependencies remain trusted. Observed disk
headroom and declared bytes are not an OS quota, durable reservation, protected
restart or protection from another process using the same account. The separate
protected-storage proposal, exact Save/registry integration and host
qualification remain outside this component.
