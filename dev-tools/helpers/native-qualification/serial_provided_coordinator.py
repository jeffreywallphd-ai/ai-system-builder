"""Fixed offline Data/UI coordinator template; never a general command runner.

The checked-in template refuses execution. A separately reviewed local consumer
replaces only _FIXED_CONTEXT, and the outer owned-job intent pins its exact bytes.
Hashes coordinate cooperative local work; they do not authenticate a hostile
operator or grant publication, model, retry or parent-qualification authority.
"""
from pathlib import Path
import hashlib
import json
import math
import os
import re
import stat
import struct
import sys
import time
import types

_FIXED_CONTEXT = None

MIB = 1024**2
GIB = 1024**3
PHASES = ("package", "ui-thin", "ui-desktop")
HELPERS = ("offline-package.mjs", "package-tree.mjs", "global-setup.mjs", "playwright.config.mjs", "serial-provided.py")
TITLES = {
    "thin": ("browser saves dataset versions, source RAG and Context packs across full service restart",
             "browser completes Data and Context review forms at native 400 percent zoom"),
    "desktop": ("packaged desktop saves dataset versions, source RAG and Context packs across complete app restart",
                "packaged desktop completes Data and Context review forms at native 400 percent zoom"),
}
PROJECTS = {"thin": "thin-chrome", "desktop": "packaged-desktop"}
SURFACES = ("dataset-preparation", "dataset-versions", "dataset-review", "dataset-row-edit", "context-pack", "context-rag", "manual-context-review", "context-browser")
TREE_CAPS = {"files": 4096, "directories": 1024, "totalBytes": 2 * GIB,
             "fileBytes": 512 * MIB, "depth": 24, "pathBytes": 768}
EMPTY_GPU_DIRS = ("resources/worker/ocr/native/build/NVIDIA Corporation",
                  "resources/worker/ocr/native/build/NVIDIA Corporation/umdlogs")


class Refused(RuntimeError):
    """Only fixed diagnostic codes may cross the reporting boundary."""


def need(value, code):
    if not value:
        raise Refused(code)


def integer(value, low=0, high=0xffffffff):
    return type(value) is int and low <= value <= high


def finite(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def hash_value(value):
    need(type(value) is str and re.fullmatch("[a-f0-9]{64}", value), "invalid-digest")
    return value


def artifact_digest(value):
    need(type(value) is str and re.fullmatch("sha256:[a-f0-9]{64}", value), "invalid-artifact-digest")
    return value


def io_path(path):
    """Use extended Windows syntax at syscalls, never as a record identity.

    Input namespaces/UNC aliases are not accepted. All supported controlled
    roots are local drive paths. No alias, registry or filesystem policy changes.
    """
    need(path.is_absolute(), "absolute-io-path-required")
    if os.name != "nt":
        return path
    need(re.fullmatch("[A-Za-z]:", path.drive) and path.root == "\\" and all(part not in (".", "..") and not part.endswith((".", " ")) for part in path.parts[1:]), "plain-local-drive-path-required")
    return Path("\\\\?\\" + str(path))


def canonical(path):
    actual = io_path(path).resolve(strict=True)
    if os.name == "nt":
        text = str(actual)
        need(re.match(r"^\\\\\?\\[A-Za-z]:\\", text), "local-canonical-path-required")
        actual = Path(text[4:])
    return actual


def absent(path):
    try:
        io_path(path).lstat()
    except FileNotFoundError:
        return True
    return False


def identity(info):
    stamp = getattr(info, "st_birthtime_ns", None) if os.name == "nt" else info.st_ctime_ns
    need(type(stamp) is int, "missing-file-time")
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, stamp


def ordinary(path, directory=False):
    need(path.is_absolute() and canonical(path) == path, "noncanonical-path")
    # Check every ancestor: an ordinary leaf does not exclude a junction parent.
    for parent in (path, *path.parents):
        info = io_path(parent).lstat()
        need(not stat.S_ISLNK(info.st_mode) and not (getattr(info, "st_file_attributes", 0) & 0x400), "redirected-path")
        if parent != path or directory:
            need(stat.S_ISDIR(info.st_mode), "ordinary-directory-required")
    info = io_path(path).lstat()
    if not directory:
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "ordinary-single-link-file-required")
    return info


def read_bytes(path, maximum, expected=None, collect=True):
    """Admit before reading; hash and parse the same stable bounded snapshot."""
    before = ordinary(path)
    need(integer(maximum, 1, 512 * MIB) and before.st_size <= maximum, "file-bound")
    value, blocks, count = hashlib.sha256(), [], 0
    with io_path(path).open("rb") as stream:
        need(identity(os.fstat(stream.fileno())) == identity(before), "open-identity-changed")
        while True:
            block = stream.read(min(MIB, maximum - count + 1))
            if not block:
                break
            count += len(block)
            need(count <= maximum, "growing-file")
            value.update(block)
            if collect:
                blocks.append(block)
        after = os.fstat(stream.fileno())
    named = ordinary(path)
    need(count == before.st_size and identity(before) == identity(after) == identity(named), "file-snapshot-changed")
    actual = value.hexdigest()
    if expected is not None:
        need(actual == hash_value(expected), "file-digest-drift")
    return b"".join(blocks) if collect else actual


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "duplicate-json-field")
        result[key] = value
    return result


def decode(raw):
    try:
        return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: need(False, "nonfinite-json"))
    except (ValueError, UnicodeError, RecursionError) as error:
        raise Refused("invalid-json") from error


def read_json(path, maximum=2 * MIB, expected=None):
    return decode(read_bytes(path, maximum, expected))


def write_fresh(path, value, maximum=2 * MIB):
    raw = (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()
    need(len(raw) <= maximum and absent(path), "fresh-bounded-output-required")
    ordinary(path.parent, True)
    with io_path(path).open("xb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    return sha(raw)


def names(folder, maximum):
    ordinary(folder, True)
    result = []
    with os.scandir(io_path(folder)) as entries:
        for entry in entries:
            need(len(result) < maximum, "directory-entry-bound")
            result.append(entry.name)
    return sorted(result)


def relative_path(value):
    need(type(value) is str and 0 < len(value.encode()) <= TREE_CAPS["pathBytes"], "relative-path-bound")
    parts = value.split("/")
    need(all(part not in ("", ".", "..") and not any(c in part for c in "\\:\x00") for part in parts), "relative-path-required")
    return Path(*parts)


def inventory(root):
    files, directories, total = [], [], 0

    def visit(folder, relative, depth):
        nonlocal total
        ordinary(folder, True)
        need(depth <= TREE_CAPS["depth"] and len(directories) < TREE_CAPS["directories"], "directory-tree-bound")
        directories.append(relative)
        for name in names(folder, TREE_CAPS["files"] + TREE_CAPS["directories"]):
            key = name if relative == "." else relative + "/" + name
            relative_path(key)
            path = folder / name
            info = io_path(path).lstat()
            if stat.S_ISDIR(info.st_mode):
                visit(path, key, depth + 1)
            else:
                need(len(files) < TREE_CAPS["files"], "file-count-bound")
                digest = read_bytes(path, TREE_CAPS["fileBytes"], collect=False)
                need(identity(info) == identity(ordinary(path)), "inventory-snapshot-changed")
                total += info.st_size
                need(total <= TREE_CAPS["totalBytes"], "total-tree-bound")
                files.append({"path": key, "bytes": info.st_size, "sha256": digest})
    visit(root, ".", 0)
    return {"files": sorted(files, key=lambda item: item["path"]), "directories": sorted(directories), "total_bytes": total}


def frame(tree):
    body = {key: value for key, value in tree.items() if key != "framed_sha256"}
    return sha(json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode())


def validate_tree(tree, root):
    need(type(tree) is dict and set(tree) == {"schema_version", "root", "caps", "files", "directories", "total_bytes", "framed_sha256"}, "package-tree-schema")
    need(tree["schema_version"] == "fixed-packaged-desktop-tree-v1" and tree["root"] == str(root) and tree["caps"] == TREE_CAPS and tree["framed_sha256"] == frame(tree), "package-tree-identity")
    need(type(tree["files"]) is list and len(tree["files"]) <= TREE_CAPS["files"] and type(tree["directories"]) is list and len(tree["directories"]) <= TREE_CAPS["directories"], "package-tree-count")
    dirs = tree["directories"]
    need(all(type(name) is str for name in dirs) and dirs == sorted(set(dirs)) and "." in dirs, "package-directories")
    for name in dirs:
        if name != ".":
            relative_path(name)
    seen, total = [], 0
    for row in tree["files"]:
        need(type(row) is dict and set(row) == {"path", "bytes", "sha256"} and integer(row["bytes"], 0, TREE_CAPS["fileBytes"]), "package-file-schema")
        relative_path(row["path"])
        hash_value(row["sha256"])
        seen.append(row["path"])
        total += row["bytes"]
    need(seen == sorted(set(seen)) and not set(seen) & set(dirs) and integer(tree["total_bytes"], 0, TREE_CAPS["totalBytes"]) and total == tree["total_bytes"], "package-file-inventory")


def compare_trees(original, before, after):
    for tree in (before, after):
        need(tree["files"] == original["files"] and tree["total_bytes"] == original["total_bytes"] and set(original["directories"]) <= set(tree["directories"]), "package-bytes-or-directory-loss")
        additions = set(tree["directories"]) - set(original["directories"])
        need(additions <= set(EMPTY_GPU_DIRS), "unexpected-package-directory")
        for row in tree["files"]:
            need(not (row["path"].lower() == EMPTY_GPU_DIRS[0].lower() or row["path"].lower().startswith(EMPTY_GPU_DIRS[0].lower() + "/")), "gpu-directory-not-empty")
    need(set(before["directories"]) <= set(after["directories"]), "phase-directory-loss")


def verify_native(observed, folder, phase):
    need(observed["limits"] == {"flags": 0x2308, "process_bytes": GIB, "job_bytes": (2 if phase == "package" else 3) * GIB, "active_limit": 32}, "native-limits")
    need(all(observed[key] is True for key in ("command_passed", "cleanup_confirmed", "all_owned_handles_close_acknowledged", "assigned_at_creation", "resumed_after_membership")), "native-retirement-unconfirmed")
    need(integer(observed["root_exit_code"], 0, 0) and integer(observed["job_accounting"]["active"], 0, 0) and integer(observed["job_accounting"]["total"], 1), "native-exit-or-accounting")
    need(all(observed[key] is False for key in ("forced_owned_job_termination", "log_overflow", "completion_message_overflow", "fence_required")) and observed["reason"] is None and observed["observed_limit_messages"] == [] and observed["cleanup_errors"] == [], "native-command-not-normal")
    need(set(observed["logs"]) == {"stdout", "stderr"}, "native-stream-set")
    for name, row in observed["logs"].items():
        file = folder / (name + ".log")
        need(row["path"] == str(file) and row["complete"] is True and integer(row["bytes"], 0, 8 * MIB) and row["bytes"] == row["observed_bytes"] == ordinary(file).st_size and row["cap_bytes"] == 8 * MIB, "native-stream-incomplete")
        read_bytes(file, 8 * MIB, row["sha256"], collect=False)


def cache_census(host, base):
    if host == "thin":
        return [("before-restart", base / "thin-runtime/provided-server-cache-1", None, None),
                ("after-restart", base / "thin-runtime/provided-server-cache-2", None, None)]
    result = []
    for phase, title, relative in (
        ("before-restart", TITLES[host][0], "dataset/provided-cache-before-restart"),
        ("after-restart", TITLES[host][0], "dataset/provided-cache-after-restart"),
        (None, TITLES[host][1], "dataset-native400/provided-cache-before-restart"),
    ):
        key = sha((PROJECTS[host] + "\0" + title + ("\0" + phase if phase else "")).encode())[:16]
        cache = base / "desktop" / relative
        result.append((phase or "native400", cache, "cleanup-" + key + ".json", "qualification-will-quit" + ("-" + phase if phase else "") + ".json"))
    return result


def require_reports(folder, host, revision):
    """Check the feature facts; a generic passed label is never sufficient."""
    result = {}
    specifications = {
        "provided-versions": ("provided-version-host-journey-v1", {"savedVersions": 2, "savedRowsPerVersion": 8, "immutableBytesAndLineage": True, "compareUi": True, "explicitSupportedSetupReuse": True, "persistedVersionIdentity": True, "restartedPreparationAndDiscard": True, "restartKind": "new-app-process" if host == "desktop" else "complete-service-recomposition"}),
        "saved-row-review": ("saved-row-review-host-journey-v1", {"savedVersions": 3, "rowCounts": [8, 8, 7], "exactVisibleValues": True, "exactParentSourceRecipeLineage": True, "originalBytesRetained": True, "persistedRecordsAndBytesAfterRestart": True}),
        "source-context": ("source-context-host-journey-v1", {"sourcePackAndRagReopened": True, "exactSavedBytesAndSourceLineage": True, "citedRetrievalAndSourceReturn": True, "originalPreservingRebuilds": 2, "cancelledDeletionRetainedCatalog": True, "selectedRemovalSurvivedReload": True, "discardedCandidateDidNotPublish": True, "desktopDownloadVerified": host == "desktop", "thinClientDownload": "not-an-existing-UI-control", "embedding": "closed-finite-vectors"}),
        "manual-context": ("manual-context-host-journey-v1", {"discardNoPublication": True, "cancelledDeletePreservedBytes": True, "confirmedCatalogRemoval": True, "deletedDetailRefused": True, "removalSurvivedRendererReload": True}),
    }
    for name, (schema, facts) in specifications.items():
        file = folder / name / (host + ".json")
        raw = read_bytes(file, 8192)
        row = decode(raw)
        extra = {"datasetSha256"} if name == "provided-versions" else {"datasetDigests"} if name == "saved-row-review" else {"workspace", "artifactId", "storageKey", "digest", "sizeBytes", "manualDigest"} if name == "manual-context" else set()
        need(type(row) is dict and set(row) == {"schemaVersion", "sourceRevision", "host", "status", "modelGeneration", "ocr", "scope"} | set(facts) | extra, "feature-report-schema")
        need(row["schemaVersion"] == schema and row["status"] == "passed" and row["host"] == host and row["sourceRevision"] == revision and row["modelGeneration"] is False and row["ocr"] is False and type(row["scope"]) is str, "feature-report-identity")
        for key, value in facts.items():
            need(type(row[key]) is type(value) and row[key] == value, "feature-assertion-missing")
        if name == "provided-versions":
            hash_value(row["datasetSha256"])
        elif name == "saved-row-review":
            need(type(row["datasetDigests"]) is list and len(row["datasetDigests"]) == 3, "row-digest-count")
            for digest in row["datasetDigests"]:
                artifact_digest(digest)
        elif name == "manual-context":
            artifact_digest(row["digest"])
            artifact_digest(row["manualDigest"])
            need(integer(row["sizeBytes"], 1, 16 * MIB) and all(type(row[key]) is str and 0 < len(row[key]) <= 768 for key in ("workspace", "artifactId", "storageKey")), "manual-context-identity")
        result[str(file)] = sha(raw)
    return result


def audit_facts(row):
    need(row["violations"] == [] and integer(row["contrastPassedNodes"], 1, 10000), "accessibility-violations-or-no-sample")
    pending = row["incomplete"]
    need(type(pending) is list and len(pending) <= 1, "accessibility-unresolved-rule")
    count = 0
    if pending:
        need(set(pending[0]) == {"rule", "nodes"} and pending[0]["rule"] == "color-contrast" and integer(pending[0]["nodes"], 1, 1000), "accessibility-unresolved-rule")
        count = pending[0]["nodes"]
    need(row["retries"] == {"attempted": count, "passed": count} and all(type(value) is int for value in row["retries"].values()), "accessibility-retry-incomplete")


def native_frame(row):
    need(finite(row["dpr"]) and abs(row["dpr"] - 4) < 1e-8 and row["cssZoom"] == "1" and type(row["visualScale"]) in (int, float) and row["visualScale"] == 1, "native-zoom-frame")
    need(integer(row["outerWidth"], 1400, 1460) and integer(row["innerWidth"], 320, 360) and integer(row["layoutWidth"], 1, row["innerWidth"]) and integer(row["overflow"], 0, 1) and integer(row["controls"], 1, 10000) and integer(row["inaccessible"], 0, 0), "native-reflow-or-controls")


def require_accessibility(folder, host, revision, run_id):
    result = {}
    for mode, title in zip(("standard", "native400"), TITLES[host]):
        key = sha(title.encode())
        branch = "critical-accessibility" if mode == "standard" else "native-critical-accessibility"
        for surface in SURFACES:
            file = folder / branch / PROJECTS[host] / key / surface / "evidence.json"
            raw = read_bytes(file, 262144)
            row = decode(raw)
            need(row["schemaVersion"] == ("critical-surface-accessibility-v1" if mode == "standard" else "native-critical-surface-accessibility-v1") and row["contextSchemaVersion"] == "critical-accessibility-context-v1" and row["host"] == PROJECTS[host] and row["testKey"] == key and row["surface"] == surface and row["runId"] == run_id and row["sourceRevision"] == revision and row["status"] == "passed", "accessibility-report-identity")
            hash_value(row["profileSha256"])
            need(type(row["profile"]) is str and 0 < len(row["profile"]) <= 256 and type(row["audits"]) is list and len(row["audits"]) == 2 and "failureStage" not in row and "finalizationStage" not in row, "accessibility-completion")
            if mode == "standard":
                need(row["scope"] == "ui-accessibility-observation-only" and row["browser"] == {"deviceScaleFactor": 1} and len(row["forcedColorsAudits"]) == 2, "standard-accessibility-frame")
                for entries in (row["audits"], row["forcedColorsAudits"]):
                    for width, audit in zip((1440, 320), entries):
                        need(audit["schemaVersion"] == "technical-accessibility-audit-v1" and integer(audit["width"], width, width), "standard-accessibility-audit")
                        audit_facts(audit)
                for width in (1440, 320):
                    for prefix in ("control-access-", "forced-colors-control-access-"):
                        controls = row[prefix + str(width)]
                        need(integer(controls["width"], width, width) and integer(controls["controls"], 1, 10000) and integer(controls["inaccessible"], 0, 0) and controls["status"] == "passed", "standard-control-access")
                motion_keys = ["motion-1440", "motion-320"]
            else:
                need(row["scope"] == "native-ui-observation-only", "native-accessibility-scope")
                native_frame(row["initialFrame"])
                for media, audit in zip(("normal", "forced-colors"), row["audits"]):
                    need(audit["schemaVersion"] == "native-technical-accessibility-audit-v1" and audit["media"] == media, "native-accessibility-media")
                    native_frame(audit["frame"])
                    audit_facts(audit.get("facts", audit))  # Final source report stores computed audit facts at top level.
                motion_keys = ["native-normal-motion", "native-forced-colors-motion"]
            for key_name in motion_keys:
                motion = row[key_name]
                need(integer(motion["elements"], 1, 100000) and all(finite(motion[k]) and motion[k] <= 0.01 for k in ("maximumTransitionMilliseconds", "maximumAnimationMilliseconds")), "reduced-motion-failed")
            result[str(file)] = sha(raw)
    return result


def verify_caches(folder, base, host, revision, phase_folder):
    inventory_row = read_json(phase_folder / "worker-evidence-inventory.json", 65536)
    expected = cache_census(host, base)
    need(inventory_row["schema_version"] == "actual-provided-single-host-worker-inventory-v1" and inventory_row["project"] == PROJECTS[host] and inventory_row["phase"] == "ui-" + host and inventory_row["source_revision"] == revision and inventory_row["native_or_parent_pass_claimed"] is False and type(inventory_row["inventories"]) is list and len(inventory_row["inventories"]) == len(expected), "worker-census-count-or-identity")
    artifacts, pids, mains = {}, set(), set()
    for item, (phase, cache, cleanup_name, ack_name) in zip(inventory_row["inventories"], expected):
        need(item["host"] == host and item["phase"] == phase and item["cache"] == str(cache) and integer(item["failure_journals"], 0, 0) and item["outer_native_retirement_still_required"] is True and type(item["workers"]) is list and 1 <= len(item["workers"]) <= 4, "worker-census-session")
        entries = names(cache, 256)
        need(not any(name.startswith("qualification-provided-failure-") for name in entries), "worker-failure-journal")
        shutdown = None
        if host == "desktop":
            cleanup = folder / "owned-host" / cleanup_name
            raw = read_bytes(cleanup, 8192)
            shutdown = decode(raw)
            need(shutdown["schemaVersion"] == "owned-host-outcome-v1" and shutdown["kind"] == "cleanup" and shutdown["status"] == "passed" and shutdown["sourceRevision"] == revision and integer(shutdown["mainExitCode"], 0, 0) and shutdown["willQuitAcknowledged"] is True and integer(shutdown["physicalWorkersObserved"], 1, 4) and integer(shutdown["physicalWorkersAlive"], 0, 0) and integer(shutdown["failures"], 0, 0) and shutdown["failureTypes"] == [] and shutdown.get("failureStages", []) == [] and "failureStage" not in shutdown and "finalizationStage" not in shutdown and finite(shutdown["cleanupMilliseconds"]), "desktop-cleanup-incomplete")
            need(all(integer(shutdown[key], 1) for key in ("mainPid", "launchedPid")) and shutdown["mainPid"] not in mains, "desktop-main-reused")
            mains.add(shutdown["mainPid"])
            artifacts[str(cleanup)] = sha(raw)
            ack = cache / ack_name
            raw = read_bytes(ack, 1024)
            value = decode(raw)
            need(value == {"pid": shutdown["mainPid"], "event": "will-quit"} and type(value["pid"]) is int, "desktop-session-acknowledgment")
            artifacts[str(ack)] = sha(raw)
        bound = []
        for worker in item["workers"]:
            identity_row = worker["identity"]
            need(set(identity_row) == {"pid", "parentPid", "scenario"} and all(integer(identity_row[key], 1) for key in ("pid", "parentPid")) and identity_row["scenario"] == "dataset-profile" and identity_row["pid"] not in pids, "worker-identity-or-reuse")
            pids.add(identity_row["pid"])
            name = "qualification-worker-identity-" + str(identity_row["pid"]) + ".json"
            need(worker["identity_file"] == name and worker["observed_alive"] is False, "worker-inventory-facts")
            file = cache / name
            raw = read_bytes(file, 1024, worker["identity_sha256"])
            need(decode(raw) == identity_row, "worker-identity-drift")
            if shutdown:
                need(identity_row["parentPid"] == shutdown["mainPid"], "worker-not-admitted-main")
            bound.append(name)
            artifacts[str(file)] = sha(raw)
        need(sorted(bound) == [name for name in entries if re.fullmatch(r"qualification-worker-identity-[1-9][0-9]{0,9}\.json", name)] and (shutdown is None or len(bound) == shutdown["physicalWorkersObserved"]), "worker-inventory-incomplete")
    if host == "thin":
        for sequence in (1, 2):
            file = base / "thin-runtime" / ("provided-server-session-" + str(sequence) + ".json")
            raw = read_bytes(file, 1024)
            row = decode(raw)
            need(set(row) == {"schemaVersion", "sequence", "sourceRevision", "previousResourcesClosed"} and row["schemaVersion"] == "provided-server-session-v1" and integer(row["sequence"], sequence, sequence) and row["sourceRevision"] == revision and row["previousResourcesClosed"] is (sequence == 2), "thin-server-session")
            artifacts[str(file)] = sha(raw)
    return artifacts


class Coordinator:
    """Only a compiled context may construct the real runner from main()."""

    def __init__(self, manifest):
        self.m = manifest
        self.root, self.candidate, self.run = (Path(manifest[key]) for key in ("root", "candidate", "run"))
        self.outer_folder = self.run / "serial-provided"
        self.output = self.outer_folder / "coordinator"
        self.helpers = self.candidate / ".local-codex/native-fixed-host-operator/v1"
        self.package_root = self.candidate / "out/ai-system-builder-win32-x64"
        self.evidence = {}

    def preserve(self):
        result = {}
        for item in self.m["preservation"]:
            path = Path(item["path"])
            need(path.is_absolute(), "preservation-path")
            if item["sha256"] is None:
                need(absent(path), "previously-absent-entry-appeared")
                result[str(path)] = None
            else:
                result[str(path)] = read_bytes(path, item["maximum"], item["sha256"], collect=False)
        for item in self.m["directory_preservation"]:
            path = Path(item["path"])
            actual = inventory(path)
            need(actual == item["inventory"], "preserved-directory-drift")
            result[str(path)] = sha(json.dumps(actual, sort_keys=True, separators=(",", ":")).encode())
        # This sole intentionally reviewed dependency junction is not traversed
        # as an ordinary source directory. Exact target/tag witnesses are required.
        link = self.candidate / "node_modules"
        info = io_path(link).lstat()
        need(getattr(info, "st_reparse_tag", None) == 0xa0000003 and canonical(link) == canonical(self.root / "node_modules"), "dependency-junction-drift")
        return result

    def read_artifact(self, path, maximum=2 * MIB, expected=None):
        raw = read_bytes(path, maximum, expected)
        self.evidence[str(path)] = sha(raw)
        return decode(raw)

    def package(self):
        row = self.read_artifact(self.run / "package-receipt.json", 65536)
        need(row["schema_version"] == "offline-production-desktop-package-v2" and row["source_revision"] == self.m["source_revision"] and row["zip_sha256"] == self.m["official_zip_sha256"] and row["only_configuration_override"] == "packagerConfig.electronZipDir", "package-production-identity")
        need(all(row[key] is True for key in ("packaging_completed", "real_production_config_and_hooks", "zip_unchanged", "packaged_OCR_resource_validated")) and row["test_pass_claimed"] is False and row["app_launched"] is False, "package-not-actual-production")
        tree_file = self.run / "packaged-tree.json"
        need(row["executable"] == str(self.package_root / "ai-system-builder.exe") and row["packaged_main"] == str(self.package_root / "resources/app/.vite/build/main.cjs") and row["packaged_tree_path"] == str(tree_file), "package-output-path")
        tree = self.read_artifact(tree_file, expected=row["packaged_tree_file_sha256"])
        validate_tree(tree, self.package_root)
        need(tree["framed_sha256"] == row["packaged_tree_framed_sha256"] and tree["total_bytes"] == row["packaged_total_bytes"] and len(tree["files"]) == row["packaged_files"] and len(tree["directories"]) == row["packaged_directories"], "package-receipt-tree-counts")
        need(inventory(self.package_root) == {key: tree[key] for key in ("files", "directories", "total_bytes")}, "actual-package-tree-drift")
        main = Path("resources/app/.vite/build/main.cjs")
        need(read_bytes(self.package_root / main, 128 * MIB, collect=False) == read_bytes(self.candidate / ".vite/build/main.cjs", 128 * MIB, collect=False), "production-main-drift")
        self.worker(row)
        return row, tree

    def worker(self, package):
        file = self.run / "packaged-ocr-worker.json"
        need(package["packaged_worker_identity_path"] == str(file), "worker-receipt-path")
        row = self.read_artifact(file, expected=package["packaged_worker_identity_sha256"])
        selected = self.candidate / "modules/adapters/runtime/python/worker"
        deployed = self.package_root / "resources/worker"
        need(row["schema_version"] == "fixed-deployed-ocr-worker-identity-v1" and row["selected_root"] == str(selected) and row["deployed_root"] == str(deployed) and row["all_worker_files_raw_exact"] is True and row["optional_build_success_inferred_from_package_exit"] is False and row["resource_runtime_or_UI_qualified"] is False, "worker-resource-identity")
        source, target = inventory(selected), inventory(deployed)
        need(source["files"] == target["files"] == row["files"] and source["total_bytes"] == target["total_bytes"] == row["total_bytes"], "deployed-worker-drift")
        body = {"files": source["files"], "total_bytes": source["total_bytes"]}
        need(sha(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()) == row["framed_sha256"] == package["packaged_worker_framed_sha256"], "worker-frame-drift")
        read_bytes(deployed / "ocr/native/WindowsOcrHelper.cs", MIB, self.m["ocr_helper_source_sha256"])
        need(row["helper_source_sha256"] == self.m["ocr_helper_source_sha256"], "ocr-source-drift")
        image = read_bytes(deployed / "ocr/native/build/WindowsOcrHelper.exe", 2 * MIB, row["helper_binary_sha256"])
        need(integer(row["helper_binary_bytes"], 256, 2 * MIB) and len(image) == row["helper_binary_bytes"] and image[:2] == b"MZ", "ocr-binary-form")
        record = self.read_artifact(deployed / "ocr/native/build/resource.json", 4096, row["helper_manifest_sha256"])
        need(record == {"schema_version": "windows-ocr-resource-v1", "provider": "windows", "provider_version": "1", "architecture": "x64", "source_sha256": row["helper_source_sha256"], "binary_sha256": row["helper_binary_sha256"], "binary_bytes": len(image)} and type(record["binary_bytes"]) is int, "ocr-resource-schema")
        offset = struct.unpack_from("<I", image, 0x3c)[0]
        need(64 <= offset <= min(4096, len(image) - 24) and image[offset:offset + 4] == b"PE\0\0" and struct.unpack_from("<H", image, offset + 4)[0] == 0x8664 and not (struct.unpack_from("<H", image, offset + 22)[0] & 0x2000), "ocr-not-x64-executable")

    def ui(self, phase, package, original, predecessor):
        host = "thin" if phase == "ui-thin" else "desktop"
        folder = self.run / phase
        setup = self.read_artifact(folder / "setup-receipt.json", 65536)
        need(setup["schema_version"] == "fixed-provided-dataset-single-host-setup-v1" and setup["project"] == PROJECTS[host] and setup["phase"] == phase and setup["source_revision"] == self.m["source_revision"] and setup["package_receipt_sha256"] == self.evidence[str(self.run / "package-receipt.json")] and type(setup["qualification_run_id"]) is str and re.fullmatch("[a-z0-9-]{20,80}", setup["qualification_run_id"]), "host-setup-identity")
        need(all(setup[key] is True for key in ("actual_provided_launch_plan", "runtime_forwarding_verified", "root_node_options_restored")) and setup["thin_host_started"] is (host == "thin") and setup["desktop_identity_prepared"] is (host == "desktop") and all(setup[key] is False for key in ("redundant_package_invoked", "model_generation", "ocr_executed", "old_space_is_total_memory_guarantee")) and setup["scenario"] == "dataset-profile" and integer(setup["child_node_old_space_bytes"], 256 * MIB, 256 * MIB), "host-setup-facts")
        before_file, after_file = folder / "packaged-tree-actual-before-ui.json", folder / "packaged-tree-actual-after-ui.json"
        before_summary = self.read_artifact(folder / "packaged-tree-before-ui.json", 65536)
        after_summary = self.read_artifact(folder / "packaged-tree-after-ui.json", 65536)
        before = self.read_artifact(before_file, expected=setup["actual_before_tree_file_sha256"])
        after = self.read_artifact(after_file, expected=after_summary["actual_after_tree_file_sha256"])
        for tree in (before, after):
            validate_tree(tree, self.package_root)
        need(before == predecessor[0], "phase-predecessor-tree-drift")
        need(before_summary["schema_version"] == "fixed-provided-package-before-ui-v1" and before_summary["project"] == PROJECTS[host] and before_summary["phase"] == phase and before_summary["source_revision"] == self.m["source_revision"] and before_summary["package_receipt_sha256"] == self.evidence[str(self.run / "package-receipt.json")] and before_summary["actual_before_tree_file_sha256"] == self.evidence[str(before_file)] and before_summary["actual_before_packaged_tree_framed_sha256"] == before["framed_sha256"] and before_summary["predecessor_after_tree_file_sha256"] == predecessor[1] and before_summary["native_retirement_proven_by_this_record"] is False, "phase-before-lineage")
        need(after_summary["schema_version"] == "fixed-provided-package-after-ui-v1" and after_summary["actual_after_packaged_tree_framed_sha256"] == after["framed_sha256"] and after_summary["packaged_worker_framed_sha256"] == package["packaged_worker_framed_sha256"] and after_summary["existing_teardown_passed"] is True and after_summary["source_identity_unchanged"] is True, "phase-after-lineage")
        for summary, tree in ((before_summary, before), (after_summary, after)):
            need(summary["original_packaged_tree_framed_sha256"] == original["framed_sha256"] and summary["added_empty_directories"] == sorted(set(tree["directories"]) - set(original["directories"])) and summary["all_packaged_files_unchanged"] is True and summary["all_original_packaged_directories_preserved"] is True, "package-phase-comparison")
        compare_trees(original, before, after)
        need(inventory(self.package_root) == {key: after[key] for key in ("files", "directories", "total_bytes")}, "actual-after-tree-drift")
        self.worker(package)
        qualification = setup["qualification_run_id"]
        evidence = self.candidate / "artifacts/qualification/visual-composer/runs" / qualification
        report = self.read_artifact(evidence / "evidence.json")
        checks = report["checks"]
        need(report["schemaVersion"] == 1 and report["runId"] == qualification and report["sourceRevision"] == self.m["source_revision"] and report["status"] == "passed" and type(checks) is list and len(checks) == 2, "two-complete-host-checks-required")
        for check, title in zip(checks, TITLES[host]):
            need(check["target"] == PROJECTS[host] and check["status"] == "passed" and type(check["id"]) is str and check["id"].endswith(" / " + title) and finite(check["durationMs"]), "host-test-inventory")
        base = self.candidate / "artifacts/qualification/visual-composer/d" / sha(qualification.encode())[:16]
        self.evidence.update(require_reports(evidence, host, self.m["source_revision"]))
        self.evidence.update(require_accessibility(evidence, host, self.m["source_revision"], qualification))
        self.evidence.update(verify_caches(evidence, base, host, self.m["source_revision"], folder))
        return after, self.evidence[str(after_file)], qualification

    def unchanged(self, baseline):
        need(self.preserve() == baseline, "input-preservation-failed")
        for name, digest in self.m["helpers"].items():
            read_bytes(self.helpers / name, 512 * 1024, digest, collect=False)
        for item in self.m["runtime"]:
            read_bytes(Path(item["path"]), item["maximum"], item["sha256"], collect=False)
        read_bytes(self.helpers / "serial-provided.py", 512 * 1024, self.m["_serial_sha256"], collect=False)

    def fences(self):
        for parent in (self.run.parent.parent, self.run.parent, self.run, self.outer_folder):
            ordinary(parent, True)
            need(absent(parent / "FENCED.json"), "retained-native-fence")
        if not absent(self.output):
            ordinary(self.output, True)
            need(absent(self.output / "FENCED.json"), "retained-native-fence")

    def execute(self, job):
        """Executed inside the outer 1500-second owned command, never on import.

        Its outer native observer remains authoritative if this process cannot
        finish its own report. This child cannot qualify its enclosing Job.
        """
        self.fences()
        # The enclosing native owner creates its two live streams before this
        # command resumes. They are not child evidence and must never be opened,
        # overwritten, hashed while live, or mistaken for an earlier attempt.
        need(set(names(self.outer_folder, 3)) <= {"stdout.log", "stderr.log"} and absent(self.output), "coordinator-output-not-fresh")
        for phase in PHASES:
            need(absent(self.run / phase), "phase-output-already-present")
        job._assert_no_pending()
        need(not job._LIVE, "unknown-owned-work")
        io_path(self.output).mkdir()
        before = self.preserve()
        self.unchanged(before)
        used = {"schema_version": "fixed-serial-provided-used-v1", "automatic_retry_allowed": False,
                "manifest_sha256": self.m["_manifest_sha256"]}
        write_fresh(self.output / "USED.json", used, 4096)
        checks, owner, failure = [], None, None
        passed, preserved, pending = False, False, False
        package, original, predecessor, run_ids = None, None, None, set()
        stage, started = "before-package", time.monotonic()
        try:
            for phase in PHASES:
                stage = phase
                self.fences()
                job._assert_no_pending()
                need(not job._LIVE, "predecessor-not-retired")
                self.unchanged(before)
                folder = self.run / phase
                need(absent(folder), "phase-output-already-present")
                io_path(folder).mkdir()  # Exact child only. Never adopt a prior directory.
                four = dict(self.m["helpers"])
                intent = job._reviewed_host_intent(phase, candidate=self.candidate,
                    node_executable=Path(self.m["node"]["path"]), node_sha256=self.m["node"]["sha256"],
                    run=self.run, folder=folder, reviewed_file_hashes=four,
                    environment=self.m["environment"], environment_sha256=self.m["environment_sha256"],
                    review_digest=self.m["_review_sha256"])
                owner = job._OwnedJob(intent, folder)
                observed = owner.run()
                digest = write_fresh(folder / "native-observation.json", observed)
                checks.append({"phase": phase, "observation_sha256": digest, "native": observed})
                verify_native(observed, folder, phase)
                job._assert_no_pending()
                need(not job._LIVE, "native-registry-not-empty")
                if phase == "package":
                    package, original = self.package()
                    predecessor = (original, None)
                else:
                    after, after_hash, run_id = self.ui(phase, package, original, predecessor)
                    need(run_id not in run_ids, "host-evidence-run-reused")
                    run_ids.add(run_id)
                    predecessor = (after, after_hash)
                self.unchanged(before)
            stage = "final-preservation"
            self.unchanged(before)
            passed = True
        except BaseException as error:
            # Raw paths, output and arbitrary exception text stay out of reports.
            failure = {"type": type(error).__name__ if type(error) in (Refused, OSError, ValueError, KeyError, TypeError, KeyboardInterrupt, SystemExit) else "OtherError",
                       "code": str(error) if type(error) is Refused else "phase-failed"}
        finally:
            if owner is not None and owner.phase != "finished":
                try:
                    write_fresh(self.output / "emergency-native-retirement.json", owner.finish("coordinator-exception"))
                except BaseException:
                    pending = True
            pending = pending or bool(job._PENDING) or bool(job._LIVE)
            try:
                self.unchanged(before)
                preserved = True
            except BaseException:
                preserved = False
            if pending:
                try:
                    if absent(self.run / "FENCED.json"):
                        write_fresh(self.run / "FENCED.json", {"reason": "new-native-lifetime-unconfirmed", "automatic_retry_allowed": False}, 4096)
                except BaseException:
                    pass  # The consumed USED record still denies reuse.
            report = {"schema_version": "actual-serial-provided-data-hosts-v1", "passed": passed and preserved and not pending,
                      "checks": checks, "artifacts": self.evidence, "source_revision": self.m["source_revision"],
                      "failure": failure, "stage": stage, "duration_seconds": time.monotonic() - started,
                      "all_reviewed_inputs_preserved": preserved, "native_lifetime_unconfirmed": pending,
                      "native_module_sha256": self.m["native_module_sha256"], "manifest_sha256": self.m["_manifest_sha256"],
                      "consumer_review_sha256": self.m["_review_sha256"], "expected_tests": 4, "expected_worker_caches": 5,
                      "model_accuracy_rerun": False, "OCR_or_provider_executed": False,
                      "outer_native_retirement_still_required": True, "current_native9_pass_inferred": False,
                      "parent_qualification_granted": False, "automatic_retry_allowed": False}
            report_hash = write_fresh(self.output / "observation.json", report, 4 * MIB)
            print(json.dumps({"passed": report["passed"], "observation": str(self.output / "observation.json"), "sha256": report_hash}), flush=True)
        need(report["passed"], "serial-provided-qualification-failed")
        return report


def validate_manifest(row):
    keys = {"schema_version", "root", "candidate", "run", "source_revision", "native_module_sha256", "node", "helpers", "runtime", "environment", "environment_sha256", "preservation", "directory_preservation", "official_zip_sha256", "ocr_helper_source_sha256"}
    need(type(row) is dict and set(row) == keys and row["schema_version"] == "fixed-serial-provided-manifest-v1", "manifest-schema")
    root, candidate, run = (Path(row[key]) for key in ("root", "candidate", "run"))
    ordinary(root, True)
    ordinary(candidate, True)
    need(re.fullmatch(r"\.local-codex/q/[a-f0-9]{8}/c", candidate.relative_to(root).as_posix()) and run.parent == candidate / ".local-codex/native-fixed-host-operator/runs" and re.fullmatch("[a-f0-9]{32}", run.name), "manifest-fixed-namespace")
    need(type(row["source_revision"]) is str and re.fullmatch(r"source\.[a-f0-9]{64}", row["source_revision"]), "source-revision")
    for key in ("native_module_sha256", "official_zip_sha256", "ocr_helper_source_sha256", "environment_sha256"):
        hash_value(row[key])
    need(type(row["node"]) is dict and set(row["node"]) == {"path", "sha256"} and Path(row["node"]["path"]).is_absolute() and Path(row["node"]["path"]).name.lower() in ("node", "node.exe"), "fixed-node-reference")
    hash_value(row["node"]["sha256"])
    # The outer intent pins all five helpers. This passive manifest contains
    # only four MJS hashes, avoiding manifest -> compiled self -> manifest cycles.
    need(type(row["helpers"]) is dict and set(row["helpers"]) == set(HELPERS[:-1]), "four-fixed-inner-helpers")
    for digest in row["helpers"].values():
        hash_value(digest)
    for key, count in (("runtime", 64), ("preservation", 10000)):
        need(type(row[key]) is list and 1 <= len(row[key]) <= count, "manifest-witness-count")
        seen = set()
        for item in row[key]:
            need(type(item) is dict and set(item) == {"path", "sha256", "maximum"} and type(item["path"]) is str and Path(item["path"]).is_absolute() and item["path"] not in seen and integer(item["maximum"], 1, 512 * MIB), "manifest-file-witness")
            seen.add(item["path"])
            if item["sha256"] is not None:
                hash_value(item["sha256"])
            else:
                need(key == "preservation", "runtime-absence-denied")
    need(type(row["directory_preservation"]) is list and 1 <= len(row["directory_preservation"]) <= 16, "manifest-directory-witness-count")
    directories = set()
    for item in row["directory_preservation"]:
        need(type(item) is dict and set(item) == {"path", "inventory"} and type(item["path"]) is str and Path(item["path"]).is_absolute() and item["path"] not in directories and type(item["inventory"]) is dict and set(item["inventory"]) == {"files", "directories", "total_bytes"}, "manifest-directory-witness")
        directories.add(item["path"])
    env = row["environment"]
    need(type(env) is dict and 1 <= len(env) <= 64 and all(type(key) is str and type(value) is str and "\0" not in key + value for key, value in env.items()) and len({key.upper() for key in env}) == len(env) and sum(len(key) + len(value) + 2 for key, value in env.items()) < 32760, "manifest-environment-bound")
    need(sha(json.dumps(env, sort_keys=True, separators=(",", ":")).encode()) == row["environment_sha256"] and env.get("NODE_OPTIONS") == "" and env.get("PYTHON_RUNTIME_QUALIFICATION_SCENARIO") == "dataset-profile" and env.get("AISB_LOCAL_DESKTOP_UI_RUN") == str(run), "manifest-environment-identity")
    original = Path(getattr(sys, "_base_executable", ""))
    need(original.is_absolute() and original.name.lower() == "python.exe" and env.get("PYTHON") == env.get("PYTHON_RUNTIME_COMMAND") == str(original), "manifest-original-python")
    pinned = {item["path"]: item for item in row["runtime"]}
    for path in (original, original.with_name("python312.dll"), Path(row["node"]["path"])):
        need(str(path) in pinned, "required-runtime-witness-missing")
    need(pinned[row["node"]["path"]]["sha256"] == row["node"]["sha256"], "node-runtime-witness-drift")
    return row


def load_context(context, script):
    """Only the compiled literal may select passive witnesses, never argv/JSON."""
    need(type(context) is dict and set(context) == {"manifest", "authorization", "review"}, "compiled-reviewed-context-required")
    captured = {}
    for name in ("manifest", "authorization", "review"):
        reference = context[name]
        need(type(reference) is dict and set(reference) == {"path", "sha256"} and type(reference["path"]) is str and Path(reference["path"]).is_absolute(), "compiled-proof-reference")
        captured[name] = (Path(reference["path"]), hash_value(reference["sha256"]))
    manifest = validate_manifest(read_json(captured["manifest"][0], 2 * MIB, captured["manifest"][1]))
    auth = read_json(captured["authorization"][0], 65536, captured["authorization"][1])
    review = read_json(captured["review"][0], 65536, captured["review"][1])
    need(set(auth) == {"schema_version", "purpose", "execution_authorized", "attempts", "manifest_sha256", "review_sha256"} and auth == {"schema_version": "fixed-serial-provided-authorization-v1", "purpose": "fixed-serial-provided-v1", "execution_authorized": True, "attempts": 1, "manifest_sha256": captured["manifest"][1], "review_sha256": captured["review"][1]} and type(auth["attempts"]) is int and auth["execution_authorized"] is True, "fixed-one-use-authorization")
    need(set(review) == {"schema_version", "disposition", "manifest_sha256", "effect_scope", "reviewer_invocation"} and review["schema_version"] == "fixed-serial-provided-effect-review-v1" and review["disposition"] == "accepted" and review["manifest_sha256"] == captured["manifest"][1] and review["effect_scope"] == "package-then-thin-then-desktop-dataset-profile" and type(review["reviewer_invocation"]) is str and 1 <= len(review["reviewer_invocation"]) <= 256, "fixed-separate-effect-review")
    helpers = Path(manifest["candidate"]) / ".local-codex/native-fixed-host-operator/v1"
    need(script == helpers / "serial-provided.py", "compiled-script-location")
    manifest["_serial_sha256"] = read_bytes(script, 512 * 1024, collect=False)
    manifest["_manifest_sha256"], manifest["_review_sha256"] = captured["manifest"][1], captured["review"][1]
    return manifest


def main():
    need(_FIXED_CONTEXT is not None, "compiled-reviewed-context-required")
    need(len(sys.argv) == 1 and os.name == "nt" and sys.flags.isolated == 1 and sys.flags.no_site == 1 and sys.dont_write_bytecode and not sys.flags.optimize, "fixed-windows-isolated-invocation")
    manifest = load_context(_FIXED_CONTEXT, Path(__file__).absolute())
    need(Path.cwd() == Path(manifest["candidate"]), "fixed-candidate-working-directory")
    path = Path(manifest["root"]) / "dev-tools/helpers/native-qualification/owned_command_job.py"
    raw = read_bytes(path, MIB, manifest["native_module_sha256"])
    module = types.ModuleType("reviewed_serial_provided_owned_job")
    module.__file__ = str(path)
    sys.modules[module.__name__] = module
    exec(compile(raw, str(path), "exec"), module.__dict__)
    need(module._REPO == Path(manifest["root"]) and module._implementation_hashes() == {"owned_command_job.py": manifest["native_module_sha256"]}, "native-source-identity")
    return Coordinator(manifest).execute(module)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"status": "unqualified", "stage": "fixed-serial-provided", "error_type": type(error).__name__ if type(error) in (Refused, OSError, ValueError, KeyError, TypeError, KeyboardInterrupt, SystemExit) else "OtherError"}), flush=True)
        raise SystemExit(1)
