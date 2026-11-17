"""Effect-free declaration for a separately reviewed Windows read-binding test."""
import argparse
import json

SCHEMA = 'windows-offload-read-binding-qualification-v1'


class _Parser(argparse.ArgumentParser):
    def error(self, _message): raise ValueError('Unsupported cache-binding qualification request.')


def current_plan():
    return {
        'schema_version': SCHEMA, 'status': 'technical-check-pending',
        'action_owner': 'agent', 'user_action': 'No action needed.',
        'component': 'fresh-windows-unused-read-binding',
        'cases': ['deadline-control', 'unused-read-binding'],
        'maximum_seconds': 120, 'maximum_active_children': 1,
        'inert_child_commit_ceiling_bytes': 512 * 1024**2,
        'ceiling_is_not_upfront_allocation_or_model_policy': True,
        'required_native_checks': [
            'actual-job-handshake-timer-and-owned-exit',
            'all-retirement-identities-before-first-original-close',
            'reverse-original-only-close-and-base-ledger-acknowledgement',
            'read-retirement-release-and-software-late-borrow-refusal',
        ],
        'qualification_complete': False, 'native_tests_executed': False,
        'native_effects': False, 'old_staging_accessed': False,
        'model_or_worker_started': False, 'quality_tests_executed': False,
        'shared_domain_qualified': False, 'production_composed': False,
        'parent_qualification_granted': False,
        'limits': 'Unused read-chain component only. No file-content preservation claim from the fresh empty cache. No fake production domain or lease. Actual shared accounting, stable fencing, production finite execution, worker/retained recovery and model resources remain separate. Accepted accuracy and OCR stay closed. Separate source and native-effect review are required.',
    }


def main(argv=None):
    try:
        parser = _Parser(description=__doc__)
        modes = parser.add_mutually_exclusive_group()
        modes.add_argument('--plan', action='store_true')
        modes.add_argument('--native', action='store_true')
        args = parser.parse_args(argv)
        if args.native:
            if __name__ != '__main__': raise ValueError('Standalone entry required.')
            import sys
            from pathlib import Path
            if not (sys.flags.isolated == sys.flags.no_site == 1 and sys.dont_write_bytecode
                    and sys.prefix == sys.base_prefix and sys.argv[1:] == ['--native']
                    and Path(sys.argv[0]).absolute() == Path(__file__).absolute()
                    and Path.cwd() == Path(__file__).absolute().parents[3]):
                raise ValueError('Isolated base runtime required.')
            import hashlib
            import stat
            import types
            path = Path(__file__).with_name('windows_offload_core_fixture.py')
            info = path.lstat()
            if not (stat.S_ISREG(info.st_mode) and not path.is_symlink()
                    and not info.st_file_attributes & 0x400 and 0 < info.st_size <= 2 * 1024**2):
                raise ValueError('Fixed source unavailable.')
            with path.open('rb') as stream: raw = stream.read(2 * 1024**2 + 1)
            if len(raw) != info.st_size: raise ValueError('Fixed source unavailable.')
            module = types.ModuleType('_standalone_windows_read_binding_engine')
            module.__file__ = str(path.absolute()); sys.modules[module.__name__] = module
            exec(compile(raw, str(path), 'exec', dont_inherit=True), module.__dict__)
            module._LOADED_SOURCE_SHA256 = hashlib.sha256(raw).hexdigest()
            result = module.standalone_native_read_binding()
            if type(result) is int and result == 9: return 9
            raise RuntimeError('Standalone owner returned without native exit.')
        print(json.dumps(current_plan(), sort_keys=True))
        return 0 if args.plan else 3
    except Exception:
        print(json.dumps({'schema_version': SCHEMA, 'status': 'request-refused',
                          'qualification_complete': False,
                          'error': 'Windows cache-binding qualification is unavailable.'}, sort_keys=True))
        return 2


if __name__ == '__main__': raise SystemExit(main())
