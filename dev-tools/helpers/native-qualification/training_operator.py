"""Pure data-only renderer for one fixed training operator; never deploys or runs.

The trusted caller still needs separate source/effect review for each phase.
This returns bytes only. It cannot authorize a native intent, retry or parent pass.
"""
from pathlib import Path, PureWindowsPath
import json
import os
import re
import stat

FILES = ('offline-package.mjs', 'playwright.config.mjs', 'global-setup.mjs', 'package-tree.mjs')
PHASES = ('training-input-create', 'training-readiness', 'training-package', 'training-ui')
MARKER = 'const FIXED_CONTEXT = null;'
TEMPLATES = Path(__file__).resolve().with_name('training-operator')
_REQUIRED = {
    'training-input-create': frozenset(),
    'training-readiness': frozenset({'input_manifest_sha256'}),
    'training-package': frozenset({'input_manifest_sha256', 'source_manifest_sha256',
                                 'electron_manifest_sha256', 'package_inputs_sha256', 'source_digest'}),
    'training-ui': frozenset({'input_manifest_sha256', 'source_identity', 'git_executable',
                            'git_sha256', 'application_sha256', 'worker_main_sha256'}),
}


def _need(value):
    if not value:
        raise ValueError('The fixed current-source training operator is unavailable.')


def reviewed_context(value):
    """Detach known finite data; these facts are not approval or file witnesses."""
    _need(type(value) is dict and all(type(key) is str for key in value))
    run, phase = value.get('run_id'), value.get('phase')
    _need(type(run) is str and re.fullmatch('[a-f0-9]{32}', run) is not None
          and type(phase) is str and phase in PHASES)
    _need(set(value) == {'run_id', 'phase'} | _REQUIRED[phase])
    result = {'run_id': run, 'phase': phase}
    for key in sorted(_REQUIRED[phase]):
        item = value[key]
        _need(type(item) is str)
        if key == 'source_identity':
            _need(re.fullmatch(r'source\.[a-f0-9]{64}', item) is not None)
        elif key == 'git_executable':
            # This is the existing trusted, separately witnessed source-reader Git.
            # It is not a general executable selector or forwarded command.
            path = PureWindowsPath(item)
            _need(0 < len(item) <= 400 and item.isascii() and all(ord(c) >= 32 and ord(c) < 127 for c in item)
                  and re.fullmatch(r'[A-Za-z]:\\', path.anchor) is not None
                  and path.name.lower() == 'git.exe' and str(path) == item
                  and all(part not in ('.', '..') and not part.endswith(('.', ' '))
                          and not any(c in part for c in ':*?"<>|;')
                          and not re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part, re.I)
                          for part in path.parts[1:]))
        else:
            _need(re.fullmatch('[a-f0-9]{64}', item) is not None)
        result[key] = item
    return result


def operator_relative(context):
    facts = reviewed_context(context)
    return f".local-codex/native-training-host-operator/v2/{facts['run_id']}/{facts['phase']}"


def render_training_operator(context):
    facts = reviewed_context(context)
    binding = 'const FIXED_CONTEXT = Object.freeze(' + json.dumps(facts, sort_keys=True, ensure_ascii=True,
                                                                 separators=(',', ':')) + ');'
    _need(len(binding) <= 4096)
    result = {}
    # Only the four literal tracked templates can supply source code.
    for name in FILES:
        filename = TEMPLATES / name
        _need(filename.resolve() == filename)
        for parent in (*reversed(TEMPLATES.parents), TEMPLATES):
            info = parent.lstat()
            _need(stat.S_ISDIR(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400)
        before = filename.lstat()
        _need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
              and not getattr(before, 'st_file_attributes', 0) & 0x400 and 0 < before.st_size <= 512 * 1024)
        with filename.open('rb') as source:
            opened = os.fstat(source.fileno())
            key = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_nlink)
            _need(key(opened) == key(before) and stat.S_ISREG(opened.st_mode)
                  and not getattr(opened, 'st_file_attributes', 0) & 0x400)
            raw = source.read(512 * 1024 + 1)
            closed = os.fstat(source.fileno())
        after = filename.lstat()
        _need(len(raw) == before.st_size <= 512 * 1024
              and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
              == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
              and key(before) == key(opened) == key(closed) == key(after)
              and opened.st_ctime_ns == closed.st_ctime_ns
              and filename.resolve() == filename and stat.S_ISREG(after.st_mode) and after.st_nlink == 1
              and not getattr(after, 'st_file_attributes', 0) & 0x400)
        text = raw.decode('utf8').replace('\r\n', '\n')
        count = 0 if name == 'package-tree.mjs' else 1
        _need(text.count(MARKER) == count)
        result[name] = (text.replace(MARKER, binding) if count else text).encode('utf8')
    return result
