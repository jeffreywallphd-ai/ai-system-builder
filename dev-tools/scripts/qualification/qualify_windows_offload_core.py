"""Effect-free declaration for the private fresh Windows staging component.

Default, plan and imported calls cannot execute native tests. The explicit
standalone mode needs separate source/effect review. It uses fixed fresh tiny
fixtures only; no existing slot, model, caller root or guard change is admitted.
"""
import argparse
import json

SCHEMA = 'windows-offload-core-qualification-v1'


class _Parser(argparse.ArgumentParser):
    def error(self, _message):
        raise ValueError('Unsupported Windows staging qualification request.')


def current_plan():
    return {
        'schema_version': SCHEMA,
        'status': 'technical-check-pending',
        'action_owner': 'agent',
        'user_action': 'No action needed.',
        'component': 'adapter-private-fresh-windows-staging',
        'supported_source_scope': 'One exclusively created private namespace, one leaf and at most one unnamed-stream index file.',
        'required_native_checks': [
            'retained-finite-execution-owner-and-deadline-denial',
            'exact-native-identity-and-fixed-local-ntfs',
            'exclusive-create-and-existing-namespace-denial',
            'empty-and-one-index-file-guarded-inventory',
            'writer-mapping-link-stream-and-late-break-denial',
            'exact-private-descriptor-and-held-handle-disposition',
            'irp-handle-retirement-and-failure-retention',
        ],
        'next_agent_work': 'Review the exact standalone fixture source and effect plan, then collect the fixed fresh component cases. Production finite execution, journal and worker composition remain separate.',
        'qualification_complete': False,
        'native_tests_executed': False,
        'native_effects': False,
        'old_staging_accessed': False,
        'model_or_worker_started': False,
        'quality_tests_executed': False,
        'parent_qualification_granted': False,
        'production_composed': False,
        'standalone_fixture': {
            'cases': ['deadline-control', 'empty-stage', 'one-index', 'namespace-denied'],
            'maximum_seconds': 120,
            'maximum_active_children': 1,
            'inert_child_commit_ceiling_bytes': 512 * 1024**2,
            'ceiling_is_not_an_upfront_allocation_or_model_policy': True,
            'native_execution_requires_separate_review': True,
        },
        'limits': 'Synthetic Core/backend/real-lease tests qualify source behavior only. The fixed standalone Job/deadline fixture is component evidence, not a production finite owner. Existing/inherited trees, protected journal, owned-worker/crash composition, actual resources and final combined testing remain separate.',
    }


def main(argv=None):
    try:
        parser = _Parser(description=__doc__)
        modes = parser.add_mutually_exclusive_group()
        modes.add_argument('--plan', action='store_true', help='Print pending checks without native, file or process effects.')
        modes.add_argument('--native', action='store_true', help='Run separately reviewed fixed fresh component cases in an isolated standalone process.')
        args = parser.parse_args(argv)
        if args.native:
            # No imported main invocation may terminate the caller's process.
            # Check before importing ctypes, opening files or constructing owners.
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
            # Compile this exact source buffer; -B alone does not disable reads
            # of previously cached bytecode by SourceFileLoader/runpy loaders.
            module = types.ModuleType('_standalone_windows_core_fixture')
            module.__file__ = str(path.absolute())
            sys.modules[module.__name__] = module
            exec(compile(raw, str(path), 'exec', dont_inherit=True), module.__dict__)
            module._LOADED_SOURCE_SHA256 = hashlib.sha256(raw).hexdigest()
            result = module.standalone_native()
            if type(result) is int and result == 9: return 9
            raise RuntimeError('Standalone owner returned without native exit.')
        print(json.dumps(current_plan(), sort_keys=True))
        return 0 if args.plan else 3
    except Exception:
        print(json.dumps({'schema_version': SCHEMA, 'status': 'request-refused',
                          'qualification_complete': False, 'error': 'Windows staging qualification is unavailable.'}, sort_keys=True))
        return 2


if __name__ == '__main__': raise SystemExit(main())
