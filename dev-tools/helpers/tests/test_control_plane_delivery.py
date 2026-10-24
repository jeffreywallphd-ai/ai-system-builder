"""Behavioral qualification; adapted upstream denial/recovery cases use local adapters."""
from __future__ import annotations

import copy
import importlib.util
import json
import multiprocessing
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.common import digest, read_json
from control_plane.contracts import ControlError
from control_plane.execution import execute
from control_plane.records import Records
from control_plane.storage import canonical_bytes, confined_path
from control_plane.work import Work, validate_spec


def race(directory, queue):
    try:
        Records(Path(directory)).mutate(lambda s: s["feedback"].update({"test": {}}), expected_revision=0)
        queue.put("passed")
    except ControlError:
        queue.put("refused")


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cp-")
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def put(self, name, content):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    def repository(self, start=True):
        self.put("AGENTS.md", "Fixture contributor entry\n")
        self.put("docs/result.md", "initial\n")
        self.put("dev-tools/scripts/docs/check-doc-drift.mjs", 'import fs from "node:fs"; process.exit(fs.readFileSync("docs/result.md","utf8").startsWith("completed") ? 0 : 1);\n')
        for args in (["init", "-q"], ["add", "."], ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]):
            r = subprocess.run(["git", *args], cwd=self.root, capture_output=True)
            self.assertEqual(r.returncode, 0, "Fixture Git preparation failed")
        self.work = Work(self.root)
        self.spec = {"schema_version": "development-work-v1", "work_id": "fixture-work", "kind": "lightweight", "title": "Correct a documented outcome", "authority_ref": "fixture-request", "outcome": {"problem": "Documented outcome is incomplete", "success": "Completed result passes its independent check", "quality": "No unrelated change", "internal_rationale": "Contributor fixture"}, "write_scope": ["docs/result.md"], "acceptance": [{"id": "result", "description": "Result is complete", "check_ids": ["documentation"]}]}
        if start:
            self.claim = self.work.start(self.spec, "author-run")["claim"]["claim_id"]

    def verify(self, content="completed\n"):
        self.put("docs/result.md", content)
        return self.work.verify("fixture-work", "author-run", self.claim)

    def review(self, receipt, **overrides):
        value = {"schema_version": "technical-review-v1", "work_id": "fixture-work", "invocation_id": "review-run", "assurance": "operator-attested", "disposition": "accepted", "receipt_digest": receipt["receipt_digest"], "findings": [], "closures": [], "reviewed_criteria": ["result"]}
        value.update(overrides)
        return self.work.review(value)


class StorageTests(Fixture):
    def test_revision_conflict_and_corruption_fail_closed(self):
        r = Records(self.root)
        r.mutate(lambda s: s["feedback"].update({"test": {}}), expected_revision=0)
        with self.assertRaises(ControlError):
            r.mutate(lambda s: None, expected_revision=0)
        value = read_json(r.path)
        value["revision"] += 1
        r.path.write_bytes(canonical_bytes(value))
        with self.assertRaises(ControlError):
            r.load()

    def test_interrupted_journal_and_state_recover_idempotently(self):
        for phase in ("journal", "state"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory(prefix="cp-") as directory:
                r = Records(Path(directory))
                with self.assertRaises(OSError):
                    r.mutate(lambda s: s["feedback"].update({"test": {}}), fault_after=phase)
                self.assertTrue(r.recover())
                self.assertFalse(r.recover())
                self.assertEqual(r.load()["revision"], 1)

    def test_two_processes_cannot_commit_the_same_revision(self):
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        workers = [context.Process(target=race, args=(str(self.root), queue)) for _ in range(2)]
        for p in workers: p.start()
        for p in workers: p.join(10)
        self.assertTrue(all(p.exitcode == 0 for p in workers))
        self.assertEqual(sorted([queue.get(timeout=2), queue.get(timeout=2)]), ["passed", "refused"])

    def test_confined_paths_and_duplicate_json_keys(self):
        for value in ("../escape", "/outside", "C:/outside"):
            with self.assertRaises(ControlError): confined_path(self.root, value)
        p = self.put("duplicate.json", '{"id":1,"id":2}')
        with self.assertRaises(ControlError): read_json(p)

    def test_no_arbitrary_journal_targets(self):
        r = Records(self.root)
        self.put(".local-codex/control-plane/transaction.json", '{"path":"../elsewhere"}')
        with self.assertRaises(ControlError): r.recover()

    def test_missing_successor_digest_preserves_journal_and_state(self):
        r = Records(self.root)
        with self.assertRaises(OSError): r.mutate(lambda s: None, fault_after="journal")
        j = read_json(r.journal)
        j["successor"].pop("state_digest")
        r.journal.write_bytes(canonical_bytes(j))
        original = r.journal.read_bytes()
        with self.assertRaises(ControlError): r.recover()
        self.assertEqual(r.journal.read_bytes(), original)
        self.assertFalse(r.path.exists())


class CatalogTests(Fixture):
    def test_focused_python_checks_never_expand_into_controlled_ai_suite(self):
        import run_focused_checks
        files = {"modules/adapters/runtime/python/worker/tests/" + n: "x" for n in ("test_unit.py", "test_constrained_json_outlines_integration.py", "test_context_generation_ai_e2e.py", "test_model_training_task_matrix_e2e.py")}
        self.put("modules/adapters/runtime/python/worker/tests/test_unit.py", "import unittest\nclass Cases(unittest.TestCase):\n    def test_value(self): pass\n")
        with patch.object(run_focused_checks, "snapshot", return_value={"files": files}):
            commands = run_focused_checks.commands(self.root, ["modules/adapters/runtime/python/worker/service.py"])
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][-1], "test_unit.py")

    def test_aggregate_checks_are_denied_before_overall_phase(self):
        self.repository(start=False)
        self.spec["acceptance"][0]["check_ids"] = ["completion-all"]
        with self.assertRaisesRegex(ControlError, "only after"):
            self.work.start(self.spec, "author-run")

    def test_focused_test_routing_uses_imports_not_mentions_of_vitest(self):
        import run_focused_checks
        node = "dev-tools/scripts/example/runner.test.mjs"
        vitest = "dev-tools/scripts/example/component.test.mjs"
        self.put(node, '''import test from "node:test";
const label = "vitest";
isVitestOwnedTestSource('import { it } from "vitest";');
''')
        self.put(vitest, 'import {\n test\n} from "vitest";')
        with patch.object(run_focused_checks, "snapshot", return_value={"files": {node: "a", vitest: "b"}}):
            commands = run_focused_checks.commands(self.root, [node])
        self.assertIn(node, commands[0])
        self.assertNotIn(vitest, commands[0])
        self.assertIn(vitest, commands[1])
        self.assertNotIn(node, commands[1])

    def test_source_owned_profiles_are_bounded_exact_and_policy_bound(self):
        import run_focused_checks
        path = "modules/example/tests/owned.test.mjs"
        other = "modules/example/tests/unrelated.test.mjs"
        self.put(path, 'import test from "node:test";')
        self.put(other, 'import test from "node:test";')
        config = "dev-tools/config/contributor-check-profiles.json"
        value = {"schema_version": "contributor-check-profiles-v1", "profiles": {"owned": {"test_paths": [path], "source_paths": [path]}}}
        self.put(config, json.dumps(value))
        with patch.object(run_focused_checks, "snapshot", return_value={"files": {path: "a", other: "b"}}):
            selected = run_focused_checks.profile_commands(self.root, "owned")
        self.assertIn(path, selected[0])
        self.assertNotIn(other, selected[0])
        before = catalog.policy_digest(self.root, catalog.definitions(self.root))
        self.put(config, json.dumps({**value, "profiles": {"owned": {"test_paths": [other], "source_paths": [other]}}}))
        self.assertNotEqual(before, catalog.policy_digest(self.root, catalog.definitions(self.root)))

    def test_profiles_reject_unknown_unsafe_missing_non_test_and_controlled_ai_paths(self):
        import run_focused_checks
        config = "dev-tools/config/contributor-check-profiles.json"
        for paths in [[], ["../outside.test.mjs"], ["--test.test.mjs"], ["modules/example/source.ts"],
                      ["modules/missing.test.ts"], ["modules/runtime/tests/test_context_generation_ai_e2e.py"],
                      ["modules/example/x.ai.test.ts"], ["modules/example/x.test.ts"] * 101]:
            self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"owned": {"test_paths": paths, "source_paths": ["modules/example/source.ts"]}}}))
            with patch.object(run_focused_checks, "snapshot", return_value={"files": {p: "a" for p in paths if p != "modules/missing.test.ts"}}):
                with self.assertRaises(ControlError):
                    run_focused_checks.profile_commands(self.root, "owned")
        self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {}}))
        with self.assertRaises(ControlError):
            run_focused_checks.profile_commands(self.root, "unknown")

    def test_profile_substitutes_only_explicitly_covered_focused_impact(self):
        config = "dev-tools/config/contributor-check-profiles.json"
        source = "modules/example/source.ts"
        profile = {"test_paths": ["modules/example/tests/owned.test.mjs"], "source_paths": [source]}
        self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"security-authority": profile}}))
        selected = catalog.plan(self.root, [source], ["security-authority"], "candidate")["selected"]
        self.assertNotIn("focused-tests", [c["id"] for c in selected])
        selected = catalog.plan(self.root, [source], ["security-authority", "focused-tests"], "candidate")["selected"]
        self.assertIn("focused-tests", [c["id"] for c in selected])
        selected = catalog.plan(self.root, [source, "modules/unknown/source.ts"], ["security-authority"], "candidate")["selected"]
        self.assertIn("focused-tests", [c["id"] for c in selected])

    def test_all_registered_profiles_require_coverage_and_keep_explicit_focused_gate(self):
        config = "dev-tools/config/contributor-check-profiles.json"
        source = "modules/example/source.ts"
        profile = {"test_paths": ["modules/example/tests/owned.test.mjs"], "source_paths": [source]}
        for name in catalog.QUALIFICATION_PROFILES:
            self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {name: profile}}))
            for paths, required, expected in [([source], [name], False), ([source], [name, "focused-tests"], True), ([source, "modules/unknown/source.ts"], [name], True)]:
                with self.subTest(name=name, paths=paths, required=required):
                    planned = catalog.plan(self.root, paths, required, "candidate")
                    self.assertEqual("focused-tests" in [c["id"] for c in planned["selected"]], expected)
                    self.assertEqual(next(c for c in planned["selected"] if c["id"] == name)["argv"][-2:], ["--profile", name])
            self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {name: {**profile, "source_paths": [source] * 201}}}))
            with self.assertRaises(ControlError):
                catalog.plan(self.root, [source], [name], "candidate")

    def test_profile_rejects_repository_ai_suite_marker(self):
        import run_focused_checks
        path = "modules/example/provider.test.ts"
        self.put(path, '// @test-suite ai\nimport {test} from "vitest";')
        self.put("dev-tools/config/contributor-check-profiles.json", json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"owned": {"test_paths": [path], "source_paths": [path]}}}))
        with patch.object(run_focused_checks, "snapshot", return_value={"files": {path: "a"}}):
            with self.assertRaises(ControlError):
                run_focused_checks.profile_commands(self.root, "owned")

    def test_ingestion_profile_is_explicit_and_keeps_unknown_and_required_coverage(self):
        import run_focused_checks
        root = HELPERS.parents[1]
        profile = read_json(root / "dev-tools/config/contributor-check-profiles.json")["profiles"]["ingestion-publication"]
        expected = [
            "modules/application/use-cases/ingestion-acquisition/tests/governed-ingestion-tasks.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-ingestion-acquisition-repository.unit.test.ts",
            "modules/adapters/persistence/ingestion/tests/structured-ingestion-file-publication-repository.unit.test.ts",
            "modules/hosts/desktop/composition/tests/desktop-ingestion-source.integration.test.ts",
            "modules/hosts/server/composition/tests/server-ingestion-source.integration.test.ts",
            "modules/application/use-cases/tests/prepare-training-dataset-from-artifacts.use-case.unit.test.ts",
            "modules/hosts/desktop/composition/tests/composeDesktopIngestionFeature.unit.test.ts",
            "modules/application/use-cases/ingestion-acquisition/tests/governed-website-ingestion.unit.test.ts",
            "modules/adapters/transport/api-express/tests/register-ingestion-task-api-route.unit.test.ts",
            "modules/adapters/storage/filesystem/artifact-store/tests/ingestion-file-byte-storage.integration.test.ts",
            "modules/ui/shared/data-management/tests/GuidedIngestionTaskPanel.interaction.ui.test.tsx",
            "modules/adapters/transport/api-express/tests/ingestion-task-http-policy.integration.test.ts",
            "modules/adapters/transport/api-express/tests/task-route-availability-dispositions.unit.test.ts",
            "apps/server/src/tests/create-server.integration.test.ts",
        ]
        self.assertEqual(profile["test_paths"], expected)
        commands = run_focused_checks.profile_commands(root, "ingestion-publication")
        self.assertEqual([path for command in commands for path in command if path in expected], sorted(expected))
        self.assertTrue(all(command[:4] == ["node", "--import", "tsx", "--test"] for command in commands))
        config = "dev-tools/config/contributor-check-profiles.json"
        self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"ingestion-publication": profile}}))
        for paths, required, focused in [
            (profile["source_paths"] + expected, ["ingestion-publication"], False),
            ([expected[0]], ["ingestion-publication", "focused-tests"], True),
            ([expected[0], "modules/unknown/source.ts"], ["ingestion-publication"], True),
        ]:
            with self.subTest(paths=paths, required=required):
                selected = catalog.plan(self.root, paths, required, "candidate")["selected"]
                self.assertEqual("focused-tests" in [check["id"] for check in selected], focused)
                self.assertEqual(next(check for check in selected if check["id"] == "ingestion-publication")["argv"][-2:], ["--profile", "ingestion-publication"])

    def test_review_profile_auto_selects_only_exact_ui_ownership_and_keeps_denials(self):
        config = "dev-tools/config/contributor-check-profiles.json"
        dom = "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs"
        profile = {"test_paths": [dom], "source_paths": [dom, config]}
        self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"review-site": profile}}))
        for paths, required, focused in [([dom, config], ["control-plane"], False),
                                         ([dom, config], ["control-plane", "focused-tests"], True),
                                         ([dom, "modules/unknown/source.ts"], ["control-plane"], True)]:
            with self.subTest(paths=paths, required=required):
                selected = catalog.plan(self.root, paths, required, "candidate")["selected"]
                ids = {c["id"] for c in selected}
                self.assertIn("review-site", ids)
                self.assertEqual("focused-tests" in ids, focused)
                self.assertEqual(ids.intersection(catalog.QUALIFICATION_PROFILES), {"review-site"})
        for path in ["dev-tools/scripts/testing/unrelated.test.mjs", "dev-tools/review-site/other.js", "docs/review.md"]:
            ids = {c["id"] for c in catalog.plan(self.root, [path], ["documentation"], "candidate")["selected"]}
            self.assertNotIn("review-site", ids)
        with self.assertRaises(ControlError):
            catalog.plan(self.root, [dom], ["unregistered-ui-check"], "candidate")

    def test_review_profile_cannot_execute_ai_or_unsafe_test_paths(self):
        import run_focused_checks
        config = "dev-tools/config/contributor-check-profiles.json"
        for path in ["../outside.test.mjs", "dev-tools/review-site/source.js", "modules/model/a.ai.test.ts",
                     "modules/runtime/tests/test_context_generation_ai_e2e.py"]:
            self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {
                "review-site": {"test_paths": [path], "source_paths": ["dev-tools/review-site/app.js"]}}}))
            with self.subTest(path=path), patch.object(run_focused_checks, "snapshot", return_value={"files": {path: "a"}}):
                with self.assertRaises(ControlError):
                    run_focused_checks.profile_commands(self.root, "review-site")

    def test_ocr_contract_profile_auto_selects_and_keeps_unknown_impact(self):
        import run_focused_checks
        root = HELPERS.parents[1]
        name = "ocr-provider-contract"
        profile = read_json(root / "dev-tools/config/contributor-check-profiles.json")["profiles"][name]
        test_path = "modules/adapters/runtime/python/worker/tests/test_ocr_protocol.py"
        source = "modules/adapters/runtime/python/worker/ocr/protocol.py"
        wire_test = "modules/adapters/runtime/python/worker/tests/test_ocr_wire.py"
        resource_test = "modules/adapters/runtime/python/worker/tests/test_ocr_resource.py"
        process_test = "modules/adapters/runtime/python/worker/tests/test_ocr_process.py"
        provider_test = "modules/adapters/runtime/python/worker/tests/test_ocr_provider.py"
        build_test = "dev-tools/scripts/native/tests/test_build_windows_ocr.py"
        hook_test = "dev-tools/scripts/native/tests/windows-ocr-build.unit.test.mjs"
        build_source = "dev-tools/scripts/native/build_windows_ocr.py"
        hook_source = "dev-tools/scripts/native/build_windows_ocr.cjs"
        forge_source = "apps/desktop/forge.config.js"
        native_test = "modules/adapters/runtime/python/worker/tests/qualification_ocr_windows.py"
        document_test = "modules/adapters/runtime/python/worker/tests/qualification_ocr_documents.py"
        self.assertEqual(profile["test_paths"], [test_path, wire_test, resource_test, process_test, provider_test, build_test, hook_test])
        self.assertIn(native_test, profile["source_paths"])
        self.assertNotIn(native_test, profile["test_paths"])
        self.assertIn(document_test, profile["source_paths"])
        self.assertNotIn(document_test, profile["test_paths"])
        self.assertIn(source, profile["source_paths"])
        commands = run_focused_checks.profile_commands(root, name)
        self.assertEqual(commands, [["node", "--test", "--", hook_test],
                                   [sys.executable, "-B", "-m", "unittest", "discover",
                                    "-s", "dev-tools/scripts/native/tests",
                                    "-p", "test_build_windows_ocr.py"],
                                   [sys.executable, "-B", "-m", "unittest", "discover",
                                   "-s", "modules/adapters/runtime/python/worker/tests",
                                   "-p", "test_ocr_process.py"],
                                   [sys.executable, "-B", "-m", "unittest", "discover",
                                    "-s", "modules/adapters/runtime/python/worker/tests",
                                    "-p", "test_ocr_protocol.py"],
                                   [sys.executable, "-B", "-m", "unittest", "discover",
                                    "-s", "modules/adapters/runtime/python/worker/tests",
                                    "-p", "test_ocr_provider.py"],
                                   [sys.executable, "-B", "-m", "unittest", "discover",
                                    "-s", "modules/adapters/runtime/python/worker/tests",
                                    "-p", "test_ocr_resource.py"],
                                   [sys.executable, "-B", "-m", "unittest", "discover",
                                    "-s", "modules/adapters/runtime/python/worker/tests",
                                    "-p", "test_ocr_wire.py"]])
        config = "dev-tools/config/contributor-check-profiles.json"
        self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {name: profile}}))
        for paths, required, expected_ocr, expected_generic in [
            ([source], ["documentation"], True, False),
            ([test_path], ["documentation"], True, False),
            ([wire_test], ["documentation"], True, False),
            ([resource_test], ["documentation"], True, False),
            ([process_test], ["documentation"], True, False),
            ([provider_test], ["documentation"], True, False),
            ([native_test], ["documentation"], True, False),
            ([document_test], ["documentation"], True, False),
            ([build_test], ["documentation"], True, False),
            ([hook_test], ["documentation"], True, False),
            ([build_source], ["documentation"], True, False),
            ([hook_source], ["documentation"], True, False),
            ([forge_source], ["documentation"], True, False),
            ([source, "modules/other/source.ts"], ["documentation"], True, True),
            ([source], ["documentation", "focused-tests"], True, True),
            (["modules/other/source.ts"], ["documentation"], False, True),
            (["modules/adapters/runtime/python/worker/tasks/other.py"], ["documentation"], False, True),
        ]:
            with self.subTest(paths=paths, required=required):
                selected = catalog.plan(self.root, paths, required, "candidate")["selected"]
                self.assertEqual(name in [row["id"] for row in selected], expected_ocr)
                self.assertEqual("focused-tests" in [row["id"] for row in selected], expected_generic)
                self.assertEqual("dependencies" in [row["id"] for row in selected],
                                 bool(set(paths) & {build_source, hook_source, forge_source}))
                if expected_ocr:
                    self.assertEqual(next(row for row in selected if row["id"] == name)["argv"][-2:], ["--profile", name])
        self.put(config, json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {
            name: {**profile, "source_paths": [test_path]},
        }}))
        selected = catalog.plan(self.root, [source], ["documentation"], "candidate")["selected"]
        self.assertIn("focused-tests", [row["id"] for row in selected])

    def test_host_memory_profile_stays_model_free_and_does_not_hide_other_impact(self):
        root = HELPERS.parents[1]
        profiles = read_json(root / "dev-tools/config/contributor-check-profiles.json")["profiles"]
        profile = profiles["host-memory-fixture"]
        self.assertEqual(profile["test_paths"], [
            "dev-tools/scripts/qualification/tests/controlled-dataset-preparation.unit.test.mjs",
            "dev-tools/scripts/qualification/tests/controlled-conversation-runtime-worker.unit.test.mjs",
            "modules/ui/shared/data-management/tests/useDatasetPreparationConstrainedJson.ui.test.tsx",
            "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-feature.unit.test.tsx",
            "apps/thin-client/src/features/dataset-preparation/tests/dataset-preparation-constrained-json.ui.test.tsx",
            "modules/adapters/runtime/python/tests/pythonRuntimeHttpProtocol.unit.test.ts",
            "modules/adapters/runtime/python/worker/tests/test_generation_capacity.py",
            "modules/adapters/runtime/python/worker/tests/test_worker_app.py",
            "modules/adapters/runtime/python/worker/tests/test_main.py",
        ])
        source = "dev-tools/scripts/qualification/visual-composer/e2e/low-memory-dataset-journey.ts"
        self.assertIn(source, profile["source_paths"])
        self.put("dev-tools/config/contributor-check-profiles.json", json.dumps({
            "schema_version": "contributor-check-profiles-v1", "profiles": {"host-memory-fixture": profile},
        }))
        for paths, focused in [([source], False), ([source, "modules/other/source.ts"], True)]:
            planned = catalog.plan(self.root, paths, ["host-memory-fixture"], "candidate")
            self.assertEqual("focused-tests" in [c["id"] for c in planned["selected"]], focused)

    def test_vitest_adapter_executes_exact_ts_path_without_tsx_sibling(self):
        self.put("modules/example/owned.test.ts", 'import {test,expect} from "vitest"; test("selected",()=>expect(1).toBe(1));')
        self.put("modules/example/owned.test.tsx", '// @test-suite ai\nimport {test} from "vitest"; test("excluded",()=>{throw new Error("unselected sibling executed")});')
        result = subprocess.run(["node", str(HELPERS / "run_vitest_checks.mjs"), "--", "modules/example/owned.test.ts"], cwd=self.root, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("unselected sibling executed", result.stdout + result.stderr)

    def test_disjoint_claims_require_separate_checkouts(self):
        self.repository()
        second = copy.deepcopy(self.spec)
        second["work_id"] = "disjoint"
        second["write_scope"] = ["docs/other.md"]
        with self.assertRaisesRegex(ControlError, "active claim"):
            self.work.start(second, "another-run")
    def test_mixed_covered_and_uncovered_paths_are_denied(self):
        with self.assertRaisesRegex(ControlError, "Every changed path"):
            catalog.plan(self.root, ["docs/a.md", "unknown/new.dat"], ["documentation"], "candidate")

    def test_deletion_and_both_rename_sides_are_classified(self):
        from control_plane.candidate import changed
        paths = changed({"docs/old.md": "a"}, {"docs/new.md": "a"})
        p = catalog.plan(self.root, paths, ["documentation"], "candidate")
        self.assertEqual(set(p["coverage"]), {"docs/old.md", "docs/new.md"})
        self.assertEqual(p, catalog.plan(self.root, paths, ["documentation"], "candidate"))


class DeliveryTests(Fixture):
    def test_public_cli_runs_real_check_review_and_completion(self):
        self.repository(start=False)
        self.put(".local-codex/work.json", json.dumps(self.spec))
        def cli(*args):
            p = subprocess.run([sys.executable, "-B", str(HELPERS / "development_control_plane.py"), "--repo", str(self.root), *args], capture_output=True, text=True, timeout=20)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            return json.loads(p.stdout)["data"]
        claim = cli("start", "--from", ".local-codex/work.json", "--invocation", "author-run")["claim"]["claim_id"]
        self.put("docs/result.md", "completed through the public CLI\n")
        receipt = cli("verify", "fixture-work", "--invocation", "author-run", "--claim", claim)
        request = {"schema_version": "technical-review-v1", "work_id": "fixture-work", "invocation_id": "review-run", "assurance": "operator-attested", "disposition": "accepted", "receipt_digest": receipt["receipt_digest"], "findings": [], "closures": [], "reviewed_criteria": ["result"]}
        self.put(".local-codex/review.json", json.dumps(request))
        cli("review", "--from", ".local-codex/review.json")
        self.assertEqual(cli("complete", "fixture-work", "--invocation", "author-run", "--claim", claim)["status"], "complete")

    def test_actual_execution_review_and_completion(self):
        self.repository()
        receipt = self.verify()
        self.assertEqual(receipt["qualification"], "passed")
        self.review(receipt)
        self.assertEqual(self.work.complete("fixture-work", "author-run", self.claim)["status"], "complete")
        with self.assertRaises(ControlError): self.work.claim("fixture-work", "author-run", self.claim)

    def test_failed_execution_cannot_be_declared_complete(self):
        self.repository()
        receipt = self.verify("broken\n")
        self.assertEqual(receipt["qualification"], "failed")
        with self.assertRaises(ControlError): self.review(receipt)

    def test_self_review_missing_coverage_and_stale_receipt_denied(self):
        self.repository()
        receipt = self.verify()
        with self.assertRaises(ControlError): self.review(receipt, invocation_id="author-run")
        with self.assertRaises(ControlError): self.review(receipt, reviewed_criteria=[])
        self.put("docs/result.md", "completed with a change\n")
        with self.assertRaises(ControlError): self.review(receipt)

    def test_acceptance_and_scope_are_frozen(self):
        self.repository()
        self.verify()
        self.put("AGENTS.md", "out of scope\n")
        with self.assertRaises(ControlError): self.work.plan("fixture-work")
        self.put("AGENTS.md", "Fixture contributor entry\n")
        self.work.records.mutate(lambda s: s["work_items"]["fixture-work"]["spec"]["acceptance"][0].update(description="weakened"))
        with self.assertRaises(ControlError): self.work.plan("fixture-work")

    def test_blocking_findings_need_correction_and_explicit_closure(self):
        self.repository()
        r = self.verify()
        finding = {"id": "finding-1", "criterion_id": "result", "description": "Outcome needs a correction", "blocking": True, "kind": "substantive"}
        self.review(r, disposition="changes-requested", findings=[finding])
        r2 = self.verify("completed with the correction\n")
        with self.assertRaises(ControlError): self.review(r2)
        self.review(r2, closures=[{"finding_id": "finding-1", "receipt_digest": r2["receipt_digest"]}])
        self.work.complete("fixture-work", "author-run", self.claim)

    def test_live_owner_overlap_expiry_and_recovery_fencing(self):
        self.repository()
        second = copy.deepcopy(self.spec); second["work_id"] = "other"
        with self.assertRaises(ControlError): self.work.start(second, "other-run")
        with self.assertRaises(ControlError): self.work.claim("fixture-work", "other-run", action="recover")
        expired = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        self.work.records.mutate(lambda s: s["work_items"]["fixture-work"]["claim"].update(expires_at=expired))
        with self.assertRaises(ControlError): self.work.verify("fixture-work", "author-run", self.claim)
        recovered = self.work.claim("fixture-work", "other-run", action="recover")
        self.assertNotEqual(recovered["claim"]["claim_id"], self.claim)
        with self.assertRaises(ControlError): self.work.claim("fixture-work", "author-run", self.claim)

    def test_private_output_is_hashed_not_persisted(self):
        result = execute(self.root, {"id": "fixture", "argv": [sys.executable, "-c", "print('synthetic-private-payload')"], "timeout": 2})
        self.assertEqual(result["status"], "passed")
        self.assertNotIn("synthetic-private-payload", json.dumps(result))

    def test_timeout_and_output_limit_are_nonqualifying(self):
        result = execute(self.root, {"id": "fixture", "argv": [sys.executable, "-c", "import time; time.sleep(3)"], "timeout": .1})
        self.assertEqual(result["status"], "timed-out")
        with patch("control_plane.execution.MAX_OUTPUT", 100):
            result = execute(self.root, {"id": "fixture", "argv": [sys.executable, "-c", "print('x'*10000)"], "timeout": 2})
        self.assertEqual(result["status"], "output-limit")


if __name__ == "__main__": unittest.main()
