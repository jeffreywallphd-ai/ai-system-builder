"""Inert declaration for separately reviewed original-source Windows checks."""
import argparse
import json

SCHEMA = 'windows-offload-sources-qualification-v2'


class _Parser(argparse.ArgumentParser):
    def error(self, _message):raise ValueError('Unsupported original-source check request.')


def current_plan():
    return {'schema_version':SCHEMA,'status':'technical-check-pending',
        'action_owner':'agent','user_action':'No action needed.',
        'component':'fresh-original-source-references',
        'cases':['deadline-control','source-read-close','source-hash-denied',
                 'source-reader-mapping-and-write-denial'],
        'maximum_seconds':120,'maximum_active_children':1,
        'inert_child_commit_ceiling_bytes':512*1024**2,
        'ceiling_is_not_upfront_allocation_or_model_policy':True,
        'shared_dispatch_slots':16384,'terminal_slots_inside_total':64,
        'required_native_checks':['original-job-handshake-timer-and-process-exit',
            'original-shared-rows-and-whole-graph-reservation',
            'exact-held-byte-hash-and-original-read-completion',
            'unused-guard-cancel-close-and-no-late-reuse',
            'changed-hash-denial-and-retained-originals',
            'original-second-reader-identity-and-exact-write-denial',
            'bounded-private-copy-view-and-ordered-original-retirement'],
        'reader_normal_slots':16,'reader_normal_calls':12,
        'reader_terminal_calls_from_existing_safety_slots':3,
        'private_copy_view_bytes':65536,'private_copy_commit_charge_bytes':65536,
        'qualification_complete':False,'native_tests_executed':False,'native_effects':False,
        'old_staging_accessed':False,'model_or_worker_started':False,
        'quality_tests_executed':False,'shared_domain_qualified':False,
        'production_composed':False,'parent_qualification_granted':False,
        'limits':'Fixed new synthetic file and ABI checks only. No real model or production source/ancestor/discovery/mapping, shared journal, model-worker/crash/restart or offload resources. Accepted quality/OCR stay closed. Source and effect review must precede actual execution.'}


def main(argv=None):
    try:
        parser=_Parser(description=__doc__,allow_abbrev=False)
        group=parser.add_mutually_exclusive_group()
        group.add_argument('--plan',action='store_true')
        group.add_argument('--native',action='store_true')
        args=parser.parse_args(argv)
        if args.native:
            import sys
            if (__name__!='__main__' or sys.argv[1:]!=['--native'] or not sys.flags.isolated
                    or not sys.flags.no_site or not sys.dont_write_bytecode or sys.prefix!=sys.base_prefix):
                raise ValueError('Standalone source check required.')
            import hashlib
            from pathlib import Path
            import stat
            import types
            path=Path(__file__).with_name('windows_offload_core_fixture.py')
            info=path.lstat()
            if not (stat.S_ISREG(info.st_mode) and not path.is_symlink()
                    and not getattr(info,'st_file_attributes',0)&0x400
                    and info.st_nlink==1 and 0<info.st_size<=2*1024**2):
                raise ValueError('Fixed source unavailable.')
            with path.open('rb')as stream:raw=stream.read(2*1024**2+1)
            if len(raw)!=info.st_size:raise ValueError('Fixed source unavailable.')
            module=types.ModuleType('_standalone_windows_sources_engine')
            module.__file__=str(path.absolute());sys.modules[module.__name__]=module
            exec(compile(raw,str(path),'exec',dont_inherit=True),module.__dict__)
            module._LOADED_SOURCE_SHA256=hashlib.sha256(raw).hexdigest()
            result=module.standalone_native_sources()
            if type(result)is int and result==9:return 9
            raise RuntimeError('Standalone owner returned without native exit.')
        print(json.dumps(current_plan(),sort_keys=True))
        return 0 if args.plan else 3
    except Exception:
        print(json.dumps({'schema_version':SCHEMA,'status':'request-refused',
            'qualification_complete':False,'error':'Windows original-source checks are unavailable.'},sort_keys=True))
        return 2


if __name__=='__main__':raise SystemExit(main())
