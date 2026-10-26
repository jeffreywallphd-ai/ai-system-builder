"""Fixed provided-data qualification: real packaged processor, no model fixture.

The outer reviewed operator owns finite native limits and exact source identity.
This entry cannot run arbitrary tasks, downloads, generation or OCR.
"""
from __future__ import annotations
import importlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys


def require_regular_source(root, source):
    candidate = Path(source.localPath)
    if not candidate.is_absolute() or candidate.resolve() != candidate or not candidate.is_relative_to(root):
        raise ValueError("A current qualification source is required.")
    for item in (root, *[root.joinpath(*candidate.relative_to(root).parts[:i])
                         for i in range(1, len(candidate.relative_to(root).parts) + 1)]):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("A regular qualification source is required.")
    info = candidate.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 16_384:
        raise ValueError("The provided qualification source exceeded its limit.")


def validate_provided(payload, root):
    plan, recipe = payload.preparation, payload.recipe
    if (plan is None or plan.method != "validate-and-split" or plan.generationMode != "none"
            or plan.inputIntent != "use-existing-dataset" or plan.sourceKinds != ["structured"]
            or recipe.task is None or recipe.task.get("taskType") != "llm-classification"
            or recipe.task.get("textInputMode") != "provided"
            or any(value is not None for value in (recipe.generation, recipe.normalization, recipe.chunking, payload.advanced))
            or len(payload.sourceInputs) != 1 or payload.output.format != "jsonl"):
        raise ValueError("Only the declared provided-data preparation is permitted.")
    source = payload.sourceInputs[0]
    if source.mediaType != "text/csv" or source.originalName != "synthetic-provided.csv":
        raise ValueError("Only the declared synthetic source is permitted.")
    require_regular_source(root, source)


def dispatch_allowed(request):
    if request.taskType not in ("prepare-training-dataset", "review-dataset"):
        raise ValueError("This qualification worker cannot execute that task.")


def write_failure_fact(cache, boundary, error, sequence):
    if boundary not in ("task", "preparation") or type(sequence) is not int or not 1 <= sequence <= 16:
        raise ValueError("The qualification failure journal limit was exceeded.")
    name = type(error).__name__
    if name not in ("ValueError", "RuntimeError", "DatasetPreparationCancellationRequested"):
        name = "other"
    body = json.dumps({"schema_version": "provided-dataset-failure-v1", "pid": os.getpid(),
                       "sequence": sequence, "boundary": boundary, "type": name})
    with (cache / f"qualification-provided-failure-{os.getpid()}-{sequence}.json").open("x", encoding="utf-8") as stream:
        stream.write(body)


def main():
    if sys.argv[1:] or os.name != "nt" or any(os.getenv(key) != "1" for key in (
            "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX")):
        raise RuntimeError("Fixed offline Windows provided-data qualification is required.")
    root = Path(__file__).resolve().parents[4]
    owned = root / "artifacts/qualification/visual-composer"
    worker = root / "out/ai-system-builder-win32-x64/resources/worker"
    if Path.cwd().resolve() != worker or worker.resolve() != worker:
        raise RuntimeError("The newly packaged worker resource is required.")
    cache = Path(os.getenv("HF_HUB_CACHE", ""))
    if (not cache.is_absolute() or cache.resolve() != cache or not cache.is_relative_to(owned)
            or not cache.is_dir()):
        raise RuntimeError("A current isolated qualification cache is required.")
    # Inspect every directory, including Windows junctions, before writing facts.
    for directory in (owned, *[owned.joinpath(*cache.relative_to(owned).parts[:i])
                              for i in range(1, len(cache.relative_to(owned).parts) + 1)]):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise RuntimeError("A regular qualification cache is required.")
    spec = importlib.util.spec_from_file_location("aisb_provided_qualification_main", worker / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    host, port = module._resolve_launch_configuration()  # Production loopback/token checks.
    application = importlib.import_module("_ai_system_builder_worker.app")
    task = importlib.import_module("_ai_system_builder_worker.tasks.prepare_training_dataset")
    original_prepare, original_dispatch = task.prepare_training_dataset, application._run_task
    with (cache / f"qualification-worker-identity-{os.getpid()}.json").open("x", encoding="utf-8") as stream:
        json.dump({"pid": os.getpid(), "parentPid": os.getppid(), "scenario": "dataset-profile"}, stream)
    failures = 0

    def observe(operation, boundary):
        def run(*args, **kwargs):
            nonlocal failures
            try:
                return operation(*args, **kwargs)
            except Exception as error:
                if failures < 16:
                    failures += 1
                    try:
                        write_failure_fact(cache, boundary, error, failures)
                    except Exception:
                        pass  # Never change the real task outcome to obtain diagnostics.
                raise
        return run

    def prepare(payload, **kwargs):
        validate_provided(payload, owned)
        return original_prepare(payload, **kwargs)

    def dispatch(request):
        dispatch_allowed(request)
        return original_dispatch(request)

    def deny_download(*args, **kwargs):
        raise ValueError("Model downloads are unavailable in this qualification fixture.")

    application.prepare_training_dataset = observe(prepare, "preparation")
    application._run_task = observe(dispatch, "task")
    application._ensure_model_download_data = deny_download
    import uvicorn
    uvicorn.run(module.app, host=host, port=port, reload=False, access_log=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"event": "qualification.provided.entry-failed"}), flush=True)
        raise SystemExit(1) from None
