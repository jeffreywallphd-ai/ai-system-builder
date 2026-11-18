# Local model adapters

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
