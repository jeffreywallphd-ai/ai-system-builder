"""Inert original-model inventory binding, not a native source owner.

Structural checks cannot prove inspector issuance or file integrity. This module
opens no files, constructs no native API, reserves no budget and grants no model,
staging, worker or readiness authority. A finite original owner and held-byte /
ancestor / discovery / native-retirement qualification are still required.
"""
import hashlib
import json
from pathlib import Path
import re

from . import local_model_offload as model

_FIELDS = frozenset(('root', '_config_bytes', 'tensors', 'bindings',
                     'source_digest', 'directory_names'))
_TENSOR_FIELDS = frozenset(('name', 'shard', 'dtype', 'shape', 'elements'))
_TOKENIZERS = frozenset(('tokenizer.json', 'tokenizer_config.json', 'vocab.json',
                         'merges.txt', 'special_tokens_map.json', 'added_tokens.json',
                         'generation_config.json', 'chat_template.jinja'))
_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,254}')
_HASH = re.compile(r'[a-f0-9]{64}')


def _need(value):
    if not value:
        raise model.OffloadAdmissionError()


def _name(value):
    _need(type(value) is str and 1 <= len(value) <= 255
          and _NAME.fullmatch(value) is not None
          and not value.endswith(('.', ' ')))
    return value


def _fields(inventory):
    _need(type(inventory) is model.LocalModelInventory)
    fields = vars(inventory)
    _need(type(fields) is dict and len(fields) == len(_FIELDS)
          and all(type(key) is str for key in fields)
          and fields.keys() == _FIELDS)
    return tuple(fields[name] for name in ('root', '_config_bytes', 'tensors',
                 'bindings', 'source_digest', 'directory_names'))


def _facts(inventory):
    root, config, tensors, bindings, digest, names = _fields(inventory)
    _need(type(root) is type(Path()) and root.is_absolute()
          and '..' not in root.parts and len(root.parts) <= 128)
    root_text = str(root)
    _need(1 <= len(root_text.encode('utf8')) <= 2048
          and type(root)(root_text).parts == root.parts
          and not any(ord(char) < 32 or ord(char) == 127 for char in root_text)
          and all(not part.endswith(('.', ' ')) for part in root.parts[1:]))
    _need(type(config) is bytes and 0 < len(config) <= model.MAX_CONFIG_BYTES)
    model._validate_config(model._json(config))  # Pure; never invoke inspection.
    _need(type(names) is tuple and 1 <= len(names) <= model.MAX_TENSORS)
    for name in names:
        _name(name)
        _need(not name.casefold().startswith(('adapter_config', 'adapter_model'))
              and not name.lower().endswith(('.bin', '.pt', '.pth', '.pkl', '.pickle')))
    _need(tuple(sorted(names)) == names and len({n.casefold() for n in names}) == len(names))
    name_set = set(names)
    _need(type(bindings) is tuple and 4 <= len(bindings) <= model.MAX_SHARDS + 10)
    rows, total, seen = [], 0, set()
    for row in bindings:
        _need(type(row) is tuple and len(row) == 3)
        name, size, file_digest = row
        _name(name)
        _need(name not in seen and name in name_set
              and type(size) is int and 0 < size <= model.MAX_MODEL_BYTES
              and type(file_digest) is str and _HASH.fullmatch(file_digest) is not None)
        seen.add(name)
        total += size
        _need(total <= model.MAX_MODEL_BYTES)  # Source ceiling, NOT staging credit.
        rows.append((name, size, file_digest))
    weights = sorted(name for name in names if name.endswith('.safetensors'))
    _need(1 <= len(weights) <= model.MAX_SHARDS
          and all(model._SHARD.fullmatch(name) is not None for name in weights))
    weight_set = set(weights)
    indexed = 'model.safetensors.index.json' in names
    _need(indexed or weights == ['model.safetensors'])
    expected = ['config.json'] + (['model.safetensors.index.json'] if indexed else [])
    expected += weights + sorted(_TOKENIZERS.intersection(names))
    _need({'tokenizer.json', 'tokenizer_config.json'}.issubset(names)
          and [row[0] for row in rows] == expected)
    files = {row[0]: row for row in rows}
    _need(files['config.json'][1:] == (len(config), hashlib.sha256(config).hexdigest()))
    for name, size, _ in rows:
        if name in weight_set:
            _need(size > 8)
        elif name == 'model.safetensors.index.json':
            _need(size <= model.MAX_HEADER_BYTES)
        elif name in _TOKENIZERS:
            _need(size <= (32 if name == 'tokenizer.json' else 8) * 1024**2)
    _need(type(digest) is str and _HASH.fullmatch(digest) is not None
          and digest == hashlib.sha256(json.dumps(bindings, separators=(',', ':')).encode()).hexdigest())
    _need(type(tensors) is tuple and 1 <= len(tensors) <= model.MAX_TENSORS)
    tensor_rows, tensor_names, shards = [], set(), set()
    payloads = {name: 0 for name in weights}
    for tensor in tensors:
        _need(type(tensor) is model.TensorInventoryEntry)
        fields = vars(tensor)
        _need(type(fields) is dict and len(fields) == len(_TENSOR_FIELDS)
              and all(type(key) is str for key in fields)
              and fields.keys() == _TENSOR_FIELDS)
        name, shard, dtype, shape, elements = (fields[key] for key in
                    ('name', 'shard', 'dtype', 'shape', 'elements'))
        _need(type(name) is str and 1 <= len(name) <= 512
              and model._NAME.fullmatch(name) is not None and name not in tensor_names
              and type(shard) is str and shard in weight_set
              and type(dtype) is str and dtype in model._DTYPE_BYTES
              and type(shape) is tuple and len(shape) <= 8)
        count = 1
        for dimension in shape:
            _need(type(dimension) is int and 0 <= dimension <= 2**24)
            count *= dimension
            _need(count <= model.MAX_MODEL_BYTES // model._DTYPE_BYTES[dtype])
        _need(type(elements) is int and elements == count)
        payloads[shard] += count * model._DTYPE_BYTES[dtype]
        _need(payloads[shard] <= files[shard][1] - 9)
        tensor_names.add(name)
        shards.add(shard)
        tensor_rows.append((name, shard, dtype, tuple(shape), elements))
    _need(shards == weight_set)
    for shard, payload in payloads.items():
        # Inspection covers the complete contiguous tensor payload. The rest
        # must fit its eight-byte prefix and the existing bounded JSON header.
        _need(1 <= files[shard][1] - 8 - payload <= model.MAX_HEADER_BYTES)
    # All facts are immutable primitives. Tensor objects and mutable Path caches
    # cannot rewrite this independent value snapshot after capture.
    return ((root_text, tuple(root.parts), root.drive, root.root), config,
            tuple(tensor_rows), tuple(rows), digest, tuple(names))


class _OriginalInventoryBinding:
    __slots__ = ('__origin', '__inventory', '__fields', '__facts',
                 '__field_origin', '__fact_origin')

    def __init__(self, inventory, facts):
        self.__origin = self
        self.__inventory = inventory
        self.__fields = _fields(inventory)
        self.__facts = facts
        self.__field_origin = self.__fields
        self.__fact_origin = self.__facts

    def __repr__(self):
        return '<inert original model inventory binding>'

    def __copy__(self):
        raise model.OffloadAdmissionError()

    def __deepcopy__(self, memo):
        raise model.OffloadAdmissionError()

    def __reduce_ex__(self, protocol):
        raise model.OffloadAdmissionError()

    def assert_original(self, inventory):
        try:
            _need(type(self) is _OriginalInventoryBinding and self.__origin is self
                  and inventory is self.__inventory
                  and type(self.__fields) is tuple and len(self.__fields) == 6
                  and type(self.__facts) is tuple and len(self.__facts) == 6
                  and self.__fields is self.__field_origin
                  and self.__facts is self.__fact_origin)
            current = _fields(inventory)
            _need(all(now is before for now, before in zip(current, self.__fields))
                  and _facts(inventory) == self.__facts)
        except Exception:
            raise model.OffloadAdmissionError() from None


def capture_original_model_inventory(inventory):
    """Validate and bind data only; a manually made valid inventory can pass.

    Never call this proof of inspector issuance, file bytes or a Native lease.
    A copied/serialized snapshot cannot authorize any subsequent file operation.
    """
    try:
        binding = _OriginalInventoryBinding(inventory, _facts(inventory))
        binding.assert_original(inventory)
        return binding
    except Exception:
        raise model.OffloadAdmissionError() from None
