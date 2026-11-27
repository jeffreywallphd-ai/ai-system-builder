"""One user-approved prospective Tiny trial; never recover an old owner."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "dev-tools/helpers"))
from control_plane.common import digest, now
from control_plane.candidate import snapshot
from control_plane.execution import execute
from control_plane.records import Records
from control_plane.work import Work

GUARD_WORK = "headless-training-safe-stage-diagnostic-guard"
TRIAL_WORK = "headless-bounded-training-safe-stage-diagnostic-20261127"
DIRECTORY = ".local-codex/headless-training-safe-stage-diagnostic-20261127"
AUTHORITY_REF = "user-approved-two-tiny-attempts-20261127-first-diagnostic"
PRIOR_CORRECTED_WORK = "headless-bounded-training-corrected-observation-20261127"
PRIOR_FRESH_WORK = "headless-bounded-training-fresh-attempt-20261127-r2"
RUNNER = "dev-tools/scripts/qualification/headless-training/bounded-training-feature.ts"
PRIOR_WORK = "headless-bounded-training-feature"
PRIOR = ["cb215d3c3409542e88860920fb889e4ad9baf8d9b859a1c3052f63a462084d41",
         "bf7abd87829766f0795638ab8fb8c7f098ba95c6aaaea34e289660bcf72bb093",
         "7a492d694beeb92e3259c9e16523dcc226fbc419c9537d70c223aa8b3fcc6129",
         "06641de84df50609608ec6b3cd0e41d244281209ec4966c20eb0f4b39798c4bf"]
PRIOR_OWNERS = (PRIOR_WORK, PRIOR_WORK, PRIOR_FRESH_WORK, PRIOR_CORRECTED_WORK)
LIMITS = {"process_memory_bytes": 2 * 1024**3, "job_memory_bytes": 4 * 1024**3,
          "maximum_active_processes": 32, "maximum_duration_ms": 690000,
          "task_duration_seconds": 600, "model_copy_bytes": 1024**2, "output_bytes": 4 * 1024**2}
RETAINED_DECLARATION = 32 * 1024**2
MINIMUM_FREE = 128 * 1024**2
START_FAILURE_CODES = frozenset({"headless.invalid-request", "headless.unsupported-version", "headless.host-changed", "headless.forbidden",
    "headless.unavailable", "headless.invalid-edit-batch", "headless.stale-revision", "headless.operation-unconfirmed",
    "headless.idempotency-conflict", "headless.idempotency-expired", "headless.operation-capacity", "headless.not-started"})

FAILURE_STAGES = frozenset({"purpose-mapping", "diffusion-delegate", "vision-delegate", "initializing", "base-model-resolution",
    "dataset-loading", "model-loading", "sequence-length", "tokenization", "adapter-configuration", "training-arguments",
    "training-loop", "serialization", "validation", "serialization-manifest", "run-metadata", "generated-candidate", "completion-report", "unclassified"})
FAILURE_TYPES = frozenset({"ValueError", "RuntimeError", "TypeError", "MemoryError", "ImportError", "ModuleNotFoundError", "OSError",
    "AttributeError", "KeyError", "IndexError", "AssertionError", "OtherError"})


class AdmissionError(ValueError):
    pass


def need(value, code):
    if value is not True:
        raise AdmissionError(code)


def validate_authorization(value, source):
    keys = {"schema_version", "authorization_ref", "attempts", "nonce", "source_digest", "guard_work_id", "prior_receipts", "limits"}
    need(isinstance(value, dict) and set(value) == keys, "fresh-trial.schema")
    need(value["schema_version"] == "headless-fresh-tiny-authorization-v1" and
         value["authorization_ref"] == AUTHORITY_REF and
         type(value["attempts"]) is int and value["attempts"] == 1, "fresh-trial.authority")
    need(isinstance(source, str) and re.fullmatch(r"[a-f0-9]{64}", source) is not None and
         value["source_digest"] == source and value["guard_work_id"] == GUARD_WORK, "fresh-trial.source")
    need(isinstance(value["nonce"], str) and re.fullmatch(r"[a-f0-9]{32}", value["nonce"]) is not None, "fresh-trial.nonce")
    need(value["prior_receipts"] == PRIOR and isinstance(value["limits"], dict) and value["limits"] == LIMITS and
         all(type(n) is int for n in value["limits"].values()),
         "fresh-trial.history-or-limits")
    return value


def plain(root, path, directory):
    need(root.is_absolute() and path.is_absolute() and path.is_relative_to(root), "fresh-trial.path")
    current = root
    for part in (None, *path.relative_to(root).parts):
        if part is not None: current = current / part
        facts = current.lstat()
        need(not stat.S_ISLNK(facts.st_mode) and not getattr(facts, "st_file_attributes", 0) & 0x400,
             "fresh-trial.alias")
        need(stat.S_ISREG(facts.st_mode) if current == path and not directory else stat.S_ISDIR(facts.st_mode),
             "fresh-trial.file-type")
    return path


def read_record(root, path, maximum=8192):
    plain(root, path, False)
    before = path.lstat()
    need(before.st_nlink == 1 and 0 < before.st_size <= maximum, "fresh-trial.record-size")
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno()); raw = stream.read(maximum + 1); after = os.fstat(stream.fileno())
    final = path.lstat()
    # The pinned Windows Python reports different ctime semantics for pathname
    # and handle observations. Preserve each API's before/after check; identity,
    # length, mtime and link count must still agree across all observations.
    key = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns, row.st_nlink)
    need(all(key(row) == key(before) for row in (opened, after, final)) and len(raw) == before.st_size and
         before.st_ctime_ns == final.st_ctime_ns and opened.st_ctime_ns == after.st_ctime_ns,
         "fresh-trial.record-changed")
    def pairs(rows):
        result = dict(rows); need(len(result) == len(rows), "fresh-trial.duplicate-key"); return result
    return json.loads(raw, object_pairs_hook=pairs)


def durable_new(root, path, value):
    plain(root, path.parent, True)
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf8")
    need(len(raw) <= 8192, "fresh-trial.record-size")
    # Never truncate, replace, delete or rearm a consumed admission, even when a
    # partial write, process termination or child failure prevents a result.
    with path.open("xb") as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())


def consume(root, authorization, source, free_bytes):
    validate_authorization(authorization, source)
    need(type(free_bytes) is int and free_bytes >= MINIMUM_FREE + (len(PRIOR) + 1) * RETAINED_DECLARATION,
         "fresh-trial.headroom")
    marker = {"schema_version": "headless-fresh-tiny-consumed-v1", "at": now(),
              "authorization_digest": digest(authorization), "source_digest": source, "nonce": authorization["nonce"],
              "prior_receipts": PRIOR, "prior_retirement": "unconfirmed", "prior_released_bytes": 0,
              "retained_logical_bytes": len(PRIOR) * RETAINED_DECLARATION,
              "new_logical_reservation_bytes": RETAINED_DECLARATION, "physical_quota_asserted": False}
    durable_new(root, root / DIRECTORY / "used.json", marker)
    return marker


def reviewed_guard(work, receipt, source):
    need(work["status"] == "complete" and receipt["source_digest"] == source and
         work["completion"]["receipt_digest"] == receipt["receipt_digest"], "fresh-trial.guard-not-current")
    review = next((r for r in work["reviews"] if r["review_digest"] == work["completion"]["review_digest"]), None)
    need(review is not None and review["disposition"] == "accepted" and
         review["review_digest"] == digest({k: v for k, v in review.items() if k != "review_digest"}) and
         review["receipt_digest"] == receipt["receipt_digest"] and review["source_digest"] == source and
         review["invocation_id"] not in work["contributors"],
         "fresh-trial.guard-review")
    # current_receipt validates the complete current plan. The review's exact
    # receipt digest binds that plan; the stored v1 review has no plan_digest.
    selected = {row["id"] for row in receipt["plan"]["selected"]}
    need("headless-training-fresh-trial-guard-unit" in selected and "headless-training-bounded-feature" not in selected,
         "fresh-trial.guard-scope")


def new_diagnostic(root, before):
    directory = root / ".local-codex/headless-training-feature"
    if not directory.exists(): return None
    plain(root, directory, True)
    names = {p.name for p in directory.iterdir()}; need(len(names) <= 64, "fresh-trial.diagnostic-capacity")
    added = names - before
    need(len(added) <= 1, "fresh-trial.diagnostic-count")
    if not added: return None
    name = added.pop(); need(re.fullmatch(r"[a-f0-9]{32}\.json", name) is not None, "fresh-trial.diagnostic-name")
    row = read_record(root, directory / name, 2048)
    need(isinstance(row, dict) and set(row) == {"schema", "phase", "startup", "sourceFactories", "outputFactories", "startCode",
         "workerRetirementConfirmed", "ownerClosureConfirmed", "modelQualityTested", "interpretation", "terminalStatus", "runtimeErrorCode", "observations", "progressObservations",
         "checkpoints", "outputFiles", "applicationCleanupConfirmed", "newRootRemoved", "runtimeFailureStage", "runtimeFailureType"}, "fresh-trial.diagnostic-schema")
    need(row["schema"] == "bounded-training-feature-diagnostic-v4" and row["phase"] in {
         "configured", "approved-start", "training", "terminal-status", "current-candidate", "candidate-lineage",
         "checkpoint-inventory", "approval-replay", "input-integrity", "complete"} and row["startup"] in {
         "not-started", "spawned", "owned-ready", "health-ready", "startup-timeout", "process-exit", "process-error", "stop-complete"},
         "fresh-trial.diagnostic-state")
    need(all(type(row[k]) is int and 0 <= row[k] <= 64 for k in ("sourceFactories", "outputFactories")) and
         all(type(row[k]) is bool for k in ("workerRetirementConfirmed", "ownerClosureConfirmed")) and
         row["modelQualityTested"] is False and row["interpretation"] == "diagnostic-only-not-qualification" and
         row["startCode"] in START_FAILURE_CODES | {None}, "fresh-trial.diagnostic-facts")
    need(row["terminalStatus"] in {"not-observed", "queued", "running", "succeeded", "failed", "cancelled", "unclassified"} and
         row["runtimeErrorCode"] in {None, "private_training_failed", "unclassified"} and
         all(type(row[k]) is int and 0 <= row[k] <= 10000 for k in ("observations", "progressObservations")) and
         row["progressObservations"] <= row["observations"] and
         all(type(row[k]) is int and 0 <= row[k] <= 32 for k in ("checkpoints", "outputFiles")) and
         row["checkpoints"] <= row["outputFiles"] and
         all(type(row[k]) is bool for k in ("applicationCleanupConfirmed", "newRootRemoved")), "fresh-trial.diagnostic-observations")
    need(row["runtimeFailureStage"] in FAILURE_STAGES | {None} and row["runtimeFailureType"] in FAILURE_TYPES | {None},
         "fresh-trial.diagnostic-failure-category")
    return row


def qualified_result(attempt, stable, diagnostic):
    return stable is True and attempt["status"] == "passed" and diagnostic is not None and diagnostic["phase"] == "complete" and \
        diagnostic["startCode"] is None and diagnostic["sourceFactories"] == 1 and diagnostic["outputFactories"] == 1 and \
        diagnostic["workerRetirementConfirmed"] is True and diagnostic["ownerClosureConfirmed"] is True and \
        diagnostic["terminalStatus"] == "succeeded" and diagnostic["runtimeErrorCode"] is None and \
        diagnostic["runtimeFailureStage"] is None and diagnostic["runtimeFailureType"] is None and \
        diagnostic["checkpoints"] > 0 and diagnostic["outputFiles"] > 0 and \
        diagnostic["applicationCleanupConfirmed"] is True and diagnostic["newRootRemoved"] is True


def validate_prior_receipts(state):
    for reference, owner in zip(PRIOR, PRIOR_OWNERS, strict=True):
        prior = state["work_items"][owner]
        receipt = next(r for r in prior["receipts"] if r["receipt_digest"] == reference)
        need(receipt["qualification"] == "failed" and digest({k: v for k, v in receipt.items() if k != "receipt_digest"}) == reference,
             "fresh-trial.prior-receipt")


def main():
    try:
        need(os.name == "nt", "fresh-trial.platform")
        root = ROOT; directory = plain(root, root / DIRECTORY, True)
        source = snapshot(root)["source_digest"]
        authorization = validate_authorization(read_record(root, directory / "authorization.json"), source)
        state = Records(root).load(); guard = state["work_items"][GUARD_WORK]
        reviewed_guard(guard, Work(root).current_receipt(guard), source)
        validate_prior_receipts(state)
        trial = state["work_items"][TRIAL_WORK]
        need(trial["status"] != "complete" and bool(trial.get("claim")) and
             any(t["task_id"] == "run-approved-fine-tuning" and t["coverage"] == "task-outcome" for t in trial["spec"]["task_targets"]),
             "fresh-trial.task-owner")
        current, plan = Work(root).context(trial)
        need(current["source_digest"] == source and "headless-training-bounded-feature" in {c["id"] for c in plan["selected"]},
             "fresh-trial.task-source")
        # A missing developer setting must not consume the one-use attempt.
        for name, is_directory in (("ASB_HEADLESS_TRAINING_TEST_PYTHON", False), ("ASB_HEADLESS_TRAINING_TEST_INPUT", True)):
            value = os.environ.get(name); need(bool(value) and Path(value).is_absolute(), "fresh-trial.test-settings")
            need(Path(value).is_dir() if is_directory else Path(value).is_file(), "fresh-trial.test-settings")
        diagnostic_directory = root / ".local-codex/headless-training-feature"
        before = set()
        if diagnostic_directory.exists():
            plain(root, diagnostic_directory, True); before = {p.name for p in diagnostic_directory.iterdir()}
            need(len(before) < 64, "fresh-trial.diagnostic-capacity")
        marker = consume(root, authorization, source, shutil.disk_usage(root).free)
        attempt = execute(root, {"id": "fresh-tiny-feature", "argv": ["node", "--import", "tsx", "--test", "--test-reporter=tap",
            "--test-concurrency=1", "--", RUNNER], "timeout": 850})
        stable = snapshot(root)["source_digest"] == source
        diagnostic = new_diagnostic(root, before)
        qualified = qualified_result(attempt, stable, diagnostic)
        result = {"schema_version": "headless-fresh-tiny-result-v1", "at": now(), "source_digest": source,
                  "consumed_digest": digest(marker), "attempt": attempt, "source_stable": stable,
                  "prior_retirement": "unconfirmed", "prior_released_bytes": 0, "model_quality_tested": False,
                  "diagnostic": diagnostic, "status": "passed" if qualified else "failed"}
        durable_new(root, directory / "result.json", result)
        print(json.dumps(result)); return 0 if result["status"] == "passed" else 1
    except Exception as error:
        code = str(error) if isinstance(error, AdmissionError) else "fresh-trial.unavailable"
        print(json.dumps({"status": "denied-or-unconfirmed", "code": code, "model_quality_tested": False})); return 1


if __name__ == "__main__":
    raise SystemExit(main())
