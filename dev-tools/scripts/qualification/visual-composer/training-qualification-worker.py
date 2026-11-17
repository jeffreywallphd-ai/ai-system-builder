"""Fixed offline Desktop training adapter. Every admitted task uses real training.

No model installation, download, accuracy evaluation or fabricated result.
"""
from __future__ import annotations
import ast
import importlib
import importlib.util
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import stat
import sys
import uuid
from types import FunctionType, ModuleType, TracebackType

MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
TINY_MODEL_ID = "aisb-testing/tiny-qwen2-v1"
OUTPUT_NAME = "training-host-support-adapter"
DATA_BYTES = b'{"instruction":"What does the help panel show?","output":"The help panel shows guidance for the current feature."}\n{"instruction":"Where are task updates?","output":"Task updates are in the notification center."}\n'


def deny():
    raise ValueError("The fixed training qualification request is unavailable.")


def _source_identity_bytes(root, target):
    """Bound two exact current source files; not a native custody capability."""
    regular_under(root, target, 64 * 1024)
    before = target.lstat()
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size,
                              value.st_mtime_ns, value.st_nlink)
    with target.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if identity(before) != identity(opened):
            deny()
        payload = stream.read(64 * 1024 + 1)
        after = os.fstat(stream.fileno())
    named = target.lstat()
    if (not 0 < len(payload) <= 64 * 1024 or len(payload) != opened.st_size or
            identity(opened) != identity(after) or identity(after) != identity(named) or
            before.st_ctime_ns != named.st_ctime_ns or opened.st_ctime_ns != after.st_ctime_ns or
            not stat.S_ISREG(named.st_mode) or named.st_nlink != 1 or
            target.is_symlink() or getattr(named, "st_file_attributes", 0) & 0x400):
        deny()
    return payload


def training_worker_directory(root, environment):
    package = environment.get("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT")
    if package is None:
        return root / "out/ai-system-builder-win32-x64/resources/worker"
    acquisition = environment.get("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION", "")
    expected_hash = environment.get("VISUAL_COMPOSER_TRAINING_INPUT_SHA256", "")
    if (not isinstance(package, str) or not isinstance(acquisition, str) or
            not isinstance(expected_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_hash) or
            not re.fullmatch(r"\.local-codex/training-inputs/tiny-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/input\.json", acquisition)):
        deny()
    target = Path(package)
    if not target.is_absolute() or not target.is_relative_to(root):
        deny()
    if not re.fullmatch(r"\.local-codex/q/[a-f0-9]{8}/o/ai-system-builder-win32-x64", target.relative_to(root).as_posix()):
        deny()
    worker = target / "resources/worker"
    try:
        if (worker.resolve() != worker or
                _source_identity_bytes(root, worker / "main.py") !=
                _source_identity_bytes(root, root / "modules/adapters/runtime/python/worker/main.py")):
            deny()
    except OSError:
        deny()
    return worker


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
    tiny = fixture.get("schemaVersion") == "training-host-fixture-v2"
    if tiny and fixture.get("inputProfile") != "generated-tiny-qwen2-v1":
        deny()
    if (base.get("modelRecordId") != fixture["baseModelRecordId"] or base.get("modelId") != (TINY_MODEL_ID if tiny else MODEL_ID) or
            base.get("provider") != ("unknown" if tiny else "huggingface") or base.get("inferenceMode") != "causal" or
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


def training_failure_facts(result, cache):
    """Classify bounded legacy text in memory. Never return that text or a path.

    Message labels are diagnostic hints, not proof of an exception's cause.
    No filesystem access, supplier import or model execution occurs here.
    """
    facts = {"schema_version": "training-failure-facts-v1", "status": "unavailable",
             "stage": "other", "error_number_kind": None, "error_number": None,
             "path_kind": "unavailable", "path_characters": None, "windows_path_utf16_units": None,
             "windows_legacy_path_limit_exceeded": None,
             "parent_qualification_granted": False}
    if type(result) is not dict:
        return facts
    error = result.get("error")
    if type(error) is not dict or type(error.get("code")) is not str or error["code"] != "training_failed":
        return facts
    details = error.get("details")
    if type(details) is dict and type(details.get("stage")) is str and details["stage"] == "dataset-loading":
        facts["stage"] = "dataset-loading"
    message = error.get("message")
    if type(message) is not str or not 0 < len(message) <= 16384:
        return facts
    # Full-match the builtin OSError rendering only. Arbitrary prose and nested
    # provider messages never become paths or trusted error identities.
    match = re.fullmatch(r"\[(Errno|WinError) ([0-9]{1,3})\] [^:\r\n]{1,160}: (['\"])([^\r\n]{1,2048})\3", message)
    if match is None:
        return facts
    kind, number, quote, raw_path = match.groups()
    number = int(number)
    if number not in ({2, 3, 5, 206} if kind == "WinError" else {2, 5, 13, 22, 28, 36}):
        return facts
    # OSError uses repr(filename): count the decoded path, not doubled Windows
    # backslashes. literal_eval admits no calls, attributes or executable code.
    try:
        raw_path = ast.literal_eval(quote + raw_path + quote)
    except (SyntaxError, ValueError):
        return facts
    if type(raw_path) is not str or not raw_path or not raw_path.isprintable():
        return facts
    path, owned = PureWindowsPath(raw_path), PureWindowsPath(str(cache))
    if not path.is_absolute() or ".." in path.parts:
        return facts
    facts.update(status="classified", error_number_kind="winerror" if kind == "WinError" else "errno",
                 error_number=number, path_kind="other", path_characters=len(raw_path),
                 windows_path_utf16_units=len(raw_path.encode("utf-16-le")) // 2,
                 windows_legacy_path_limit_exceeded=len(raw_path.encode("utf-16-le")) // 2 >= 260)
    if path.is_relative_to(owned):
        facts["path_kind"] = "owned-cache-lock" if path.suffix == ".lock" else "owned-cache-file"
    return facts


def write_training_failure_facts(result, cache, dataset_cache=None):
    """One fixed, exclusive leaf in the already admitted fresh test cache.

    This is local qualification evidence, not native custody or a test pass.
    The caller isolates diagnostic failure from the actual training result.
    """
    if not cache.is_absolute() or cache.resolve() != cache or not cache.is_dir():
        deny()
    info = cache.lstat()
    if cache.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
        deny()
    facts_root = cache if dataset_cache is None else dataset_cache
    payload = (json.dumps(training_failure_facts(result, facts_root), separators=(",", ":")) + "\n").encode("utf8")
    if len(payload) > 1024:
        deny()
    target = cache / "qualification-training-failure.json"
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(payload)


def single_training_dispatch(original, fixture, model_directory, temp_directory, inspect_file=admit_dataset,
                             failure_observer=None):
    used = False

    def dispatch(request):
        nonlocal used
        if used:
            deny()
        validate_training_request(request, fixture, model_directory, temp_directory, inspect_file)
        used = True
        result = original(request)
        if (failure_observer is not None and type(result) is dict and
                type(result.get("status")) is str and result["status"] == "failed"):
            try:
                failure_observer(result)
            except Exception:
                # Missing diagnostic evidence stays missing; never retry, hide
                # the original failure, or manufacture a successful task.
                pass
        # Preserve exact return identity, including failure/cancellation.
        return result
    return dispatch


def deny_download(*_args, **_kwargs):
    deny()


def dataset_exception_facts(error, loader):
    """Finite exception/source facts only; never stringify or inspect payloads."""
    facts = {"schema_version": "training-dataset-exception-v1", "status": "unavailable",
             "stage": "dataset-loading", "exceptions": [], "chain_truncated": False,
             "parent_qualification_granted": False}
    if not isinstance(error, BaseException):
        return facts
    sources = []
    def admit_function(value, label):
        if type(value) is staticmethod or type(value) is classmethod:
            value = value.__func__
        if type(value) is FunctionType:
            sources.append((value.__code__, label))
    admit_function(loader, "training-loader")
    # Compare code identity from fixed already-loaded functions. Do not inspect
    # traceback filenames, code names, frame locals or arbitrary module members.
    for name, label, functions, classes in (
        ("datasets.builder", "datasets-builder", (),
         (("DatasetBuilder", ("__init__", "_build_cache_dir", "download_and_prepare", "_download_and_prepare", "as_dataset", "_as_dataset")),
          ("ArrowBasedBuilder", ("_prepare_split", "_prepare_split_single")))),
        ("datasets.load", "datasets-load", ("load_dataset", "load_dataset_builder", "dataset_module_factory"),
         (("PackagedDatasetModuleFactory", ("__init__", "get_module")),)),
        ("datasets.packaged_modules.json.json", "datasets-json", (),
         (("Json", ("_split_generators", "_generate_tables")),)),
        ("datasets.utils._filelock", "datasets-filelock", (),
         (("FileLock", ("__init__", "hash_filename_if_too_long")),)),
        ("filelock._windows", "filelock-windows", (),
         (("WindowsFileLock", ("_acquire", "_release")),)),
        ("filelock._api", "filelock-api", (), (("BaseFileLock", ("acquire", "release", "__enter__")),)),
        ("datasets.download.download_manager", "datasets-download-manager", (),
         (("DownloadManager", ("download", "download_and_extract", "extract", "_download_single")),)),
        ("datasets.utils.file_utils", "datasets-file-utils", ("cached_path", "get_from_cache", "xopen"), ()),
        ("fsspec.implementations.local", "fsspec-local", ("make_path_posix",),
         (("LocalFileSystem", ("_open", "_strip_protocol", "makedirs", "info", "exists")),
          ("LocalFileOpener", ("__init__", "_open")))),
    ):
        module = sys.modules.get(name)
        if type(module) is not ModuleType:
            continue
        namespace = module.__dict__
        for attribute in functions:
            admit_function(namespace.get(attribute), label)
        for attribute, methods in classes:
            kind = namespace.get(attribute)
            if type(kind) is type:
                for method in methods:
                    admit_function(kind.__dict__.get(method), label)
    builtins = ((FileNotFoundError, "FileNotFoundError"), (PermissionError, "PermissionError"),
                (NotADirectoryError, "NotADirectoryError"), (IsADirectoryError, "IsADirectoryError"),
                (FileExistsError, "FileExistsError"), (NotImplementedError, "NotImplementedError"),
                (ValueError, "ValueError"), (TypeError, "TypeError"), (RuntimeError, "RuntimeError"),
                (OSError, "OSError"), (MemoryError, "MemoryError"), (ImportError, "ImportError"),
                (ModuleNotFoundError, "ModuleNotFoundError"), (AttributeError, "AttributeError"),
                (KeyError, "KeyError"), (IndexError, "IndexError"), (AssertionError, "AssertionError"))
    known = list(builtins)
    for name, attribute, label in (("datasets.exceptions", "DatasetGenerationError", "DatasetGenerationError"),
                                   ("datasets.exceptions", "DatasetGenerationCastError", "DatasetGenerationCastError"),
                                   ("datasets.exceptions", "DatasetNotFoundError", "DatasetNotFoundError"),
                                   ("pyarrow.lib", "ArrowInvalid", "ArrowInvalid"),
                                   ("pyarrow.lib", "ArrowNotImplementedError", "ArrowNotImplementedError"),
                                   ("pyarrow.lib", "ArrowKeyError", "ArrowKeyError")):
        module = sys.modules.get(name)
        kind = module.__dict__.get(attribute) if type(module) is ModuleType else None
        if type(kind) is type:
            known.append((kind, label))
    current, seen = error, set()
    facts["status"] = "observed"
    while current is not None and len(facts["exceptions"]) < 3 and id(current) not in seen:
        seen.add(id(current))
        kind = type(current)
        label = next((name for candidate, name in known if kind is candidate), "OtherError")
        number = None
        if any(kind is candidate for candidate in (OSError, FileNotFoundError, PermissionError,
                                                    NotADirectoryError, IsADirectoryError, FileExistsError)):
            candidate = OSError.errno.__get__(current)
            if type(candidate) is int and candidate in {1, 2, 3, 5, 8, 12, 13, 22, 24, 28, 32, 36, 80, 206}:
                number = candidate
        # Base slots bypass private/custom exception property overrides. Frame
        # locals, code names, raw filenames, exception args and messages stay unread.
        trace = BaseException.__traceback__.__get__(current)
        frames, scanned = [], 0
        while type(trace) is TracebackType and scanned < 16:
            scanned += 1
            code, line = trace.tb_frame.f_code, trace.tb_lineno
            source = next((label for candidate, label in sources if code is candidate), None)
            if source is not None and type(line) is int and 1 <= line <= 1_000_000:
                frames.append({"source": source, "line": line})
            trace = trace.tb_next
        facts["exceptions"].append({"error_type": label, "errno": number, "frames": frames,
                                    "frames_scanned": scanned, "traceback_truncated": trace is not None})
        cause = BaseException.__cause__.__get__(current)
        if cause is None and not BaseException.__suppress_context__.__get__(current):
            cause = BaseException.__context__.__get__(current)
        current = cause if isinstance(cause, BaseException) else None
    facts["chain_truncated"] = current is not None
    return facts


def write_dataset_exception_facts(error, cache, loader):
    """Exclusive fixed local test evidence, never a result or custody grant."""
    if not cache.is_absolute() or cache.resolve() != cache or not cache.is_dir():
        deny()
    info = cache.lstat()
    if cache.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
        deny()
    payload = (json.dumps(dataset_exception_facts(error, loader), separators=(",", ":")) + "\n").encode("utf8")
    if len(payload) > 8192:
        deny()
    fd = os.open(cache / "qualification-dataset-exception.json",
                 os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(payload)


def observe_training_dataset_loader(original, failure_observer):
    """Observe the app-owned loader seam; do not patch the dataset supplier."""
    def observed(*args, **kwargs):
        try:
            return original(*args, **kwargs)
        except Exception as error:
            try:
                failure_observer(error)
            except Exception:
                pass
            raise
    return observed


def prepare_training_dataset_cache(root, worker, cache, environment, run):
    """One fresh dataset-only leaf in the admitted Tiny package's own run.

    The supplier duplicates its cache spelling into a lock filename. A fixed
    worker-relative spelling avoids that duplication without changing cwd or
    patching the supplier. This is cooperative test isolation, not native custody.
    Legacy profiles retain their original cache and environment unchanged.
    """
    package = environment.get("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT")
    if package is None:
        return None
    match = re.fullmatch(r"training-ui-([a-f0-9]{32})-01", run) if type(run) is str else None
    if match is None or type(package) is not str:
        deny()
    identity = match.group(1)
    acquisition = f".local-codex/training-inputs/tiny-{uuid.UUID(hex=identity)}/input.json"
    short = root / ".local-codex/q" / identity[:8]
    expected_package = short / "o/ai-system-builder-win32-x64"
    if (not root.is_absolute() or root.resolve() != root or package != str(expected_package) or
            worker != expected_package / "resources/worker" or
            environment.get("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION") != acquisition or
            environment.get("HF_DATASETS_CACHE") != str(cache / "datasets")):
        deny()
    # Inspect only the already admitted package's ancestor chain. Never inspect
    # or adopt a pre-existing dataset leaf, even when it appears empty.
    for current in (root, *[root.joinpath(*worker.relative_to(root).parts[:i])
                           for i in range(1, len(worker.relative_to(root).parts) + 1)]):
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode) or current.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
            deny()
    target = short / "d"
    relative = os.path.relpath(target, worker)
    if (relative != os.path.join("..", "..", "..", "..", "d") or
            Path(os.path.abspath(worker / relative)) != target):
        deny()
    try:
        target.mkdir(mode=0o700)
    except OSError:
        deny()
    info = target.lstat()
    if (not stat.S_ISDIR(info.st_mode) or target.resolve() != target or target.is_symlink() or
            getattr(info, "st_file_attributes", 0) & 0x400):
        deny()
    environment["HF_DATASETS_CACHE"] = relative
    return target


def activate_training_dataset_working_directory(root, worker, dataset_cache, environment, run):
    """Use only this fresh Tiny child's admitted short root before imports.

    Datasets duplicates an absolute cache name into its lock filename. Fsspec
    expands parent-relative writer paths without normalization. A short cwd and
    the fixed cache spelling d avoid both expansions without supplier patches.
    These cooperative directory checks are not native custody or race proof.
    """
    if dataset_cache is None:
        return
    match = re.fullmatch(r"training-ui-([a-f0-9]{32})-01", run) if type(run) is str else None
    if match is None:
        deny()
    identity = match.group(1)
    short = root / ".local-codex/q" / identity[:8]
    package = short / "o/ai-system-builder-win32-x64"
    acquisition = f".local-codex/training-inputs/tiny-{uuid.UUID(hex=identity)}/input.json"
    if (environment.get("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT") != str(package) or
            environment.get("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION") != acquisition or
            environment.get("HF_DATASETS_CACHE") != os.path.join("..", "..", "..", "..", "d") or
            worker != package / "resources/worker" or dataset_cache != short / "d"):
        deny()
    if not root.is_absolute() or root.resolve() != root or Path.cwd() != worker:
        deny()
    known = (root, *[root.joinpath(*worker.relative_to(root).parts[:i])
                    for i in range(1, len(worker.relative_to(root).parts) + 1)], dataset_cache)
    for current in known:
        info = current.lstat()
        if (not stat.S_ISDIR(info.st_mode) or current.is_symlink() or current.resolve() != current or
                getattr(info, "st_file_attributes", 0) & 0x400):
            deny()
    try:
        os.chdir(short)
    except OSError:
        deny()
    if Path.cwd() != short:
        deny()
    environment["HF_DATASETS_CACHE"] = "d"


def main():
    if sys.argv[1:] or os.name != "nt" or any(os.getenv(key) != "1" for key in
            ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE", "PIP_NO_INDEX")):
        deny()
    root = Path(__file__).resolve().parents[4]
    worker = training_worker_directory(root, os.environ)
    if Path.cwd() != worker or worker.resolve() != worker:
        deny()
    run = os.getenv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "")
    source = os.getenv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION", "")
    raw_fixture = os.getenv("VISUAL_COMPOSER_TRAINING_FIXTURE", "")
    if not re.fullmatch(r"[a-z0-9-]{20,80}", run) or not re.fullmatch(r"source\.[a-f0-9]{64}", source) or len(raw_fixture.encode("utf-8")) > 4096:
        deny()
    fixture = json.loads(raw_fixture)
    if (not isinstance(fixture, dict) or fixture.get("schemaVersion") not in ("training-host-fixture-v1", "training-host-fixture-v2") or
            fixture.get("runId") != run or fixture.get("sourceRevision") != source):
        deny()
    tiny = fixture["schemaVersion"] == "training-host-fixture-v2"
    if os.getenv("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT") is not None and not tiny:
        deny()
    if (set(fixture) != {"schemaVersion", "runId", "sourceRevision", "workspaceId", "baseModelRecordId", "datasetArtifactIds", "outputName", "displayName"} | ({"inputProfile"} if tiny else set()) or
            tiny and fixture.get("inputProfile") != "generated-tiny-qwen2-v1" or
            fixture.get("outputName") != OUTPUT_NAME or fixture.get("displayName") != "Training host support adapter"):
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
    inputs = prerequisites.inspect(root, os.getenv("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION"), os.getenv("VISUAL_COMPOSER_TRAINING_INPUT_SHA256"))
    if tiny != (inputs.get("inputProfile") == "generated-tiny-qwen2-v1"):
        deny()
    model = root / inputs["modelRelativeDirectory"]
    dataset_cache = prepare_training_dataset_cache(root, worker, cache, os.environ, run)
    activate_training_dataset_working_directory(root, worker, dataset_cache, os.environ, run)
    spec = importlib.util.spec_from_file_location("aisb_training_qualification_main", worker / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    host, port = module._resolve_launch_configuration()  # Real token and loopback guard.
    application = importlib.import_module("_ai_system_builder_worker.app")
    if dataset_cache is not None:
        training_tasks = importlib.import_module("_ai_system_builder_worker.tasks.train_model")
        original_dataset_loader = training_tasks._load_dataset
        training_tasks._load_dataset = observe_training_dataset_loader(original_dataset_loader,
            lambda error: write_dataset_exception_facts(error, cache, original_dataset_loader))
    application._run_task = single_training_dispatch(application._run_task, fixture, model, temp,
        failure_observer=lambda result: write_training_failure_facts(result, cache, dataset_cache))
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
