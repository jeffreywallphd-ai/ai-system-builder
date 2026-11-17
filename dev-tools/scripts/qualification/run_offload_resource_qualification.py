"""Fixed low-memory resource gate. Model execution awaits the native provider.

This entry never imports accuracy runners, scores output, reads old staging,
starts a process or collects a model result. The separate quality record remains
outside this resource run. Native resource and lifetime checks remain pending.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError
from modules.adapters.runtime.python.worker.tasks.offload_recovery import current_guarded_context, require_guarded_context
from offload_guarded_restart import guarded_restart_readiness


class _Parser(argparse.ArgumentParser):
    def error(self, _message): raise ValueError("Unsupported resource qualification request.")


def current_resource_plan():
    readiness = guarded_restart_readiness()
    admitted = False
    try:
        require_guarded_context(current_guarded_context())
        admitted = True
    except OffloadAdmissionError:
        pass
    return {
        "schema_version": "offload-resource-qualification-v1",
        "status": "pending-native-protection" if not admitted else "pending-resource-execution",
        "qualification_complete": False,
        "resource_tests_executed": False,
        "quality_tests_executed": False,
        "model_or_worker_started": False,
        "old_staging_accessed": False,
        "new_staging_created": False,
        "parent_qualification_granted": False,
        "quality_status": "outside-this-resource-run",
        "quality_record": "docs/operations/model-software-quality-qualification.json",
        "recovery_readiness": readiness,
        "next_agent_work": "Implement and qualify the native protection, protected accounting and parent-owned retirement backend before any model resource run.",
        "limits": "This gate and synthetic lifecycle tests provide no native, model-resource, crash-recovery or parent pass. Accepted accuracy tests remain closed.",
    }


def main(argv=None):
    try:
        parser = _Parser(description=__doc__)
        parser.add_argument("--plan", action="store_true", help="Print current readiness without starting a worker or model.")
        args = parser.parse_args(argv)
        result = current_resource_plan()
        print(json.dumps(result, sort_keys=True))
        return 0 if args.plan else 3
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        print(json.dumps({"schema_version": "offload-resource-qualification-v1", "status": "request-refused", "qualification_complete": False, "error": "Resource qualification is unavailable."}, sort_keys=True))
        return 2


if __name__ == "__main__": raise SystemExit(main())
