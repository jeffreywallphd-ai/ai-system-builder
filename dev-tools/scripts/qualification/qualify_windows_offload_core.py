"""Effect-free declaration for the private fresh Windows staging component.

This entry is deliberately not a native test executor. Actual effects need the
separate reviewed fresh-fixture owner. It cannot inspect an existing slot, start
a process/model, select a root or change a guard. Accepted accuracy stays closed.
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
        'next_agent_work': 'Implement the retained finite execution owner and review the fresh-fixture operator before executing its fixed cases on the exact source.',
        'qualification_complete': False,
        'native_tests_executed': False,
        'native_effects': False,
        'old_staging_accessed': False,
        'model_or_worker_started': False,
        'quality_tests_executed': False,
        'parent_qualification_granted': False,
        'production_composed': False,
        'limits': 'Synthetic Core/backend/real-lease tests qualify source behavior only. A real finite execution owner is still missing. Existing/inherited trees, protected journal, owned-worker/crash composition, actual resources and final combined testing remain separate.',
    }


def main(argv=None):
    try:
        parser = _Parser(description=__doc__)
        parser.add_argument('--plan', action='store_true', help='Print pending checks without native, file or process effects.')
        args = parser.parse_args(argv)
        print(json.dumps(current_plan(), sort_keys=True))
        return 0 if args.plan else 3
    except (ValueError, TypeError, KeyError, RuntimeError):
        print(json.dumps({'schema_version': SCHEMA, 'status': 'request-refused',
                          'qualification_complete': False, 'error': 'Windows staging qualification is unavailable.'}, sort_keys=True))
        return 2


if __name__ == '__main__': raise SystemExit(main())
