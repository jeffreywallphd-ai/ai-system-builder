"""Fixed offline Desktop training adapter. Every admitted task uses real training.

No model installation, download, accuracy evaluation or fabricated result.
"""
from __future__ import annotations
import importlib
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
OUTPUT_NAME = "training-host-support-adapter"
DATA_BYTES = b'{"instruction":"What does the help panel show?","output":"The help panel shows guidance for the current feature."}\n{"instruction":"Where are task updates?","output":"Task updates are in the notification center."}\n'


def deny():
    raise ValueError("The fixed training qualification request is unavailable.")


def regular_under(root, target, maximum):
    if not root.is_absolute() or root.resolve() != root or not target.is_relative_to(root):
        deny()
    for current in (root, *[root.joinpath(*target.relative_to(root).parts[:i])
                           for i in range(1, len(target.relative_to(root).parts) + 1)]):
        info = current.lstat()
        if current.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
            deny()
    info = target.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= maximum:
        deny()
    return target


def admit_dataset(root, target, maximum):
    regular_under(root, target, maximum)
    if target.read_bytes() != DATA_BYTES:
        deny()


def exact_options(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional):
        deny()
    for key, expected in required.items():
        actual = value.get(key)
        if actual != expected or (isinstance(expected, bool) and type(actual) is not bool) or (isinstance(expected, (int, float)) and not isinstance(expected, bool) and type(actual) not in (int, float)):
            deny()
    if any(value.get(key) is not None for key in optional):
        deny()


def validate_training_request(request, fixture, model_directory, temp_directory, inspect_file=admit_dataset):
    """Admit only the declared tiny real local task, before delegating once."""
    if request.taskType != "train-model" or not isinstance(request.payload, dict):
        deny()
    payload = request.payload
    if payload.get("workspaceId") != fixture["workspaceId"] or not isinstance(request.metadata, dict) or request.metadata.get("workspaceId") != fixture["workspaceId"]:
        deny()
    if payload.get("trainingTask") != "llm-instruction" or payload.get("method") != "lora":
        deny()
    base, common, output, validation = (payload.get(key) for key in ("baseModel", "commonParameters", "output", "validation"))
    if any(not isinstance(item, dict) for item in (base, common, output, validation)):
        deny()
    if (base.get("modelRecordId") != fixture["baseModelRecordId"] or base.get("modelId") != MODEL_ID or
            base.get("provider") != "huggingface" or base.get("inferenceMode") != "causal" or
            base.get("localPath") != str(model_directory)):
        deny()
    exact_options(common, {"numEpochs": 1, "maxSteps": 1, "batchSize": 1, "learningRate": .0002, "maxSequenceLength": 64, "seed": 7}, ("weightDecay",))
    advanced = payload.get("advancedParameters")
    if not isinstance(advanced, dict): deny()
    exact_options(advanced, {"gradientAccumulationSteps": 1, "checkpointIntervalSteps": 100, "evalIntervalSteps": 100, "gradientCheckpointing": False, "lora": advanced.get("lora")},
                  ("warmupSteps", "warmupRatio", "schedulerType", "saveTotalLimit", "mixedPrecision", "quantization"))
    exact_options(advanced.get("lora"), {"rank": 1, "alpha": 2, "dropout": .05}, ("targetModules",))
    exact_options(output, {"outputModelName": OUTPUT_NAME, "maxShardSize": "2GB", "destination": {"local": {"enabled": True}},
                          "registration": output.get("registration")}, ("localOutputDirectory", "outputDirectory"))
    exact_options(output.get("registration"), {"displayName": "Training host support adapter", "artifactForm": "adapter"},
                  ("inferenceMode", "taskTags", "baseModelId", "adapterOfModelId", "metadata"))
    exact_options(validation, {"enabled": False, "expectedLoRA": True, "expectedRecurrentAdditions": False}, ("taskTags",))
    datasets = payload.get("datasets")
    if not isinstance(datasets, list) or len(datasets) != 2:
        deny()
    for index, row in enumerate(datasets):
        if (not isinstance(row, dict) or row.get("artifactId") != fixture["datasetArtifactIds"][index] or
                row.get("splitRole") != ("train", "validation")[index] or row.get("format") != "jsonl" or
                not isinstance(row.get("path"), str)):
            deny()
        inspect_file(temp_directory, Path(row["path"]), 8192)


def single_training_dispatch(original, fixture, model_directory, temp_directory, inspect_file=admit_dataset):
    used = False

    def dispatch(request):
        nonlocal used
        if used:
            deny()
        validate_training_request(request, fixture, model_directory, temp_directory, inspect_file)
        used = True
        # Return the original result unchanged, including failure/cancellation.
        return original(request)
    return dispatch


def deny_download(*_args, **_kwargs):
    deny()


def main():
    if sys.argv[1:] or os.name != "nt" or any(os.getenv(key) != "1" for key in
            ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE", "PIP_NO_INDEX")):
        deny()
    root = Path(__file__).resolve().parents[4]
    worker = root / "out/ai-system-builder-win32-x64/resources/worker"
    if Path.cwd() != worker or worker.resolve() != worker:
        deny()
    run = os.getenv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "")
    source = os.getenv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION", "")
    raw_fixture = os.getenv("VISUAL_COMPOSER_TRAINING_FIXTURE", "")
    if not re.fullmatch(r"[a-z0-9-]{20,80}", run) or not re.fullmatch(r"source\.[a-f0-9]{64}", source) or len(raw_fixture.encode("utf-8")) > 4096:
        deny()
    fixture = json.loads(raw_fixture)
    if (not isinstance(fixture, dict) or fixture.get("schemaVersion") != "training-host-fixture-v1" or
            fixture.get("runId") != run or fixture.get("sourceRevision") != source):
        deny()
    workspace = "workspace.training-host." + hashlib.sha256((run + "\0training-host-v1").encode()).hexdigest()[:16]
    if (fixture.get("workspaceId") != workspace or fixture.get("datasetArtifactIds") != [f"workspaces/{workspace}/artifacts/files/training-host-{role}.jsonl" for role in ("train", "validation")] or
            not isinstance(fixture.get("baseModelRecordId"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{3,191}", fixture["baseModelRecordId"])):
        deny()
    data_root = Path(os.getenv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", ""))
    fence = root / "artifacts/qualification/visual-composer/d"
    if not data_root.is_absolute() or data_root.resolve() != data_root or not data_root.is_relative_to(fence) or data_root.name != "training":
        deny()
    cache, temp = data_root / "controlled-model-cache", data_root / "training-temp"
    if any(not value.is_dir() or value.resolve() != value for value in (cache, temp)) or any(os.getenv(key) != str(temp) for key in ("TEMP", "TMP")):
        deny()
    if os.getenv("HF_HUB_CACHE") != str(cache):
        deny()
    # Reuse the canonical read-only hash check; no accuracy runner is imported.
    spec = importlib.util.spec_from_file_location("training_input_prerequisites", Path(__file__).with_name("training-host-prerequisites.py"))
    prerequisites = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prerequisites)
    inputs = prerequisites.inspect(root, os.getenv("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION"))
    model = root / inputs["modelRelativeDirectory"]
    spec = importlib.util.spec_from_file_location("aisb_training_qualification_main", worker / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    host, port = module._resolve_launch_configuration()  # Real token and loopback guard.
    application = importlib.import_module("_ai_system_builder_worker.app")
    application._run_task = single_training_dispatch(application._run_task, fixture, model, temp)
    application._ensure_model_download_data = deny_download
    with (cache / f"qualification-worker-identity-{os.getpid()}.json").open("x", encoding="utf-8") as stream:
        json.dump({"pid": os.getpid(), "parentPid": os.getppid(), "scenario": "training-model-host"}, stream)
    import uvicorn
    uvicorn.run(module.app, host=host, port=port, reload=False, access_log=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"event":"qualification.training.entry-failed","reason":"fixed-training-prerequisites"}', flush=True)
        raise SystemExit(1) from None
