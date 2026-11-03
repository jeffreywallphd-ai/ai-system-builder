"""Inert declaration for the separately reviewed fixed Source runtime check."""
import argparse
import hashlib
import json
from pathlib import Path
import os
import stat
import sys
import types

SCHEMA = 'windows-offload-source-session-qualification-v1'


class _Parser(argparse.ArgumentParser):
    def error(self, _message):raise ValueError('Unsupported Source runtime request.')


def _native_environment():
    if (__name__ != '__main__' or os.name != 'nt' or sys.argv[1:] != ['--native']
            or not sys.flags.isolated or not sys.flags.no_site
            or not sys.dont_write_bytecode or sys.prefix != sys.base_prefix):
        raise ValueError('Fixed standalone Source runtime required.')


def _load_fixture():
    """Compile the fixed, stable source buffer; no developer import search."""
    _native_environment()
    path = Path(__file__).absolute().with_name('windows_offload_source_session_fixture.py')
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or path.is_symlink()
            or getattr(before, 'st_file_attributes', 0) & 0x400
            or not 0 < before.st_size <= 2 * 1024**2):
        raise ValueError('Fixed Source fixture required.')
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
    with path.open('rb') as stream:
        if identity(os.fstat(stream.fileno())) != identity(before):
            raise ValueError('Fixed Source fixture changed.')
        raw = stream.read(2 * 1024**2 + 1)
        if identity(os.fstat(stream.fileno())) != identity(before):
            raise ValueError('Fixed Source fixture changed.')
    if len(raw) != before.st_size or identity(path.lstat()) != identity(before):
        raise ValueError('Fixed Source fixture changed.')
    name = '_standalone_source_session_qualification'
    if name in sys.modules:
        raise ValueError('Fixed Source fixture already loaded.')
    module = types.ModuleType(name)
    module.__file__ = str(path)
    module._QUALIFICATION_SOURCE_SHA256 = hashlib.sha256(raw).hexdigest()
    sys.modules[name] = module  # Retain even a partially initialized module.
    exec(compile(raw, str(path), 'exec', dont_inherit=True), module.__dict__)
    module._NATIVE_ENTRY = module._ENTRY_TOKEN
    return module


def current_plan():
    return {'schema_version': SCHEMA, 'status': 'technical-check-pending',
            'action_owner': 'agent', 'user_action': 'No action needed.',
            'cases': ['source-roundtrip'], 'maximum_seconds': 120,
            'child_commit_ceiling_bytes': 512 * 1024**2,
            'ceiling_is_not_upfront_allocation_or_model_policy': True,
            'shared_rows_per_actor': 16384, 'terminal_rows_inside_total': 64,
            'engine_normal_rows': 1024, 'child_engine_terminal_rows': 16,
            'source_unused_close_rows_remaining': 48, 'frame_fragment_attempts': 32,
            'required_checks': ['original-handle-watchdog-and-inherited-dispatch-event',
                                'fixed-source-bootstrap-and-original-child-job',
                                'original-inventory-inside-child-and-one-shared-row-table',
                                'prepare-one-check-unused-retire-and-finish',
                                'actual-child-exit-job-zero-original-closes-and-timer-quiescence'],
            'native_effects': False, 'native_tests_executed': False, 'qualification_complete': False,
            'model_started': False, 'quality_tests_executed': False, 'old_staging_accessed': False,
            'borrower_started': False, 'production_composed': False, 'parent_qualification_granted': False,
            'limits': 'New fixed synthetic inputs only. No model, borrower, real-model resource, staging, shared-domain or production qualification. Source and effect review precede execution. Accepted model quality and OCR stay closed.'}


def main(argv=None):
    try:
        parser = _Parser(description=__doc__, allow_abbrev=False)
        group = parser.add_mutually_exclusive_group()
        group.add_argument('--plan', action='store_true')
        group.add_argument('--native', action='store_true')
        args = parser.parse_args(argv)
        if args.native:
            _native_environment()
            return _load_fixture().run_native()
        print(json.dumps(current_plan(), sort_keys=True))
        return 0 if args.plan else 3
    except Exception:
        print(json.dumps({'schema_version': SCHEMA, 'status': 'request-refused',
                          'qualification_complete': False,
                          'error': 'The fixed Source runtime check is unavailable.'}, sort_keys=True))
        return 2


if __name__ == '__main__':raise SystemExit(main())
