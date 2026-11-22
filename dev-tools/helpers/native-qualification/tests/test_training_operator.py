"""Real rendering/syntax/refusal fixtures only; no native or model execution."""
from pathlib import Path
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / 'training_operator.py'
SPEC = importlib.util.spec_from_file_location('training_operator_under_test', FILE)
operator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator)


def context(phase):
    result = {'run_id': 'a' * 32, 'phase': phase}
    for key in operator._REQUIRED[phase]:
        result[key] = ('source.' + 'b' * 64 if key == 'source_identity' else
                       r'C:\Program Files\Git\cmd\git.exe' if key == 'git_executable' else 'c' * 64)
    return result


class TrainingOperatorTests(unittest.TestCase):
    def test_all_four_phases_render_exact_closed_files_and_detached_bytes(self):
        for phase in operator.PHASES:
            value = context(phase)
            before = json.dumps(value, sort_keys=True)
            rendered = operator.render_training_operator(value)
            self.assertEqual(set(rendered), set(operator.FILES))
            self.assertEqual(before, json.dumps(value, sort_keys=True))
            value.clear()
            for name, raw in rendered.items():
                self.assertIs(type(raw), bytes)
                self.assertLess(len(raw), 512 * 1024)
                self.assertNotIn(operator.MARKER.encode(), raw)
                self.assertNotIn(b'4aa53cb0', raw)
                if name != 'package-tree.mjs':
                    self.assertIn(f'"phase":"{phase}"'.encode(), raw)

    def test_relative_directory_is_only_fixed_run_and_role(self):
        for phase in operator.PHASES:
            self.assertEqual(operator.operator_relative(context(phase)),
                f'.local-codex/native-training-host-operator/v2/{"a" * 32}/{phase}')

    def test_unknown_missing_or_execution_fields_are_refused(self):
        for key in ('command', 'cwd', 'root', 'environment', 'seconds', 'process_bytes',
                    'script', 'quota', 'helper_directory', 'retry', 'approved'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                operator.render_training_operator({**context('training-ui'), key: 'untrusted'})
        for value in ({}, {'run_id': 'a' * 32}, {**context('training-readiness'), 'phase': 'training-budget'}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                operator.reviewed_context(value)
        for key in context('training-ui'):
            value = context('training-ui')
            del value[key]
            with self.subTest(missing=key), self.assertRaises(ValueError):
                operator.reviewed_context(value)

    def test_active_mappings_keys_and_values_are_rejected_before_hooks(self):
        class Active(dict):
            def get(self, *_):
                raise AssertionError('Do not invoke mapping hooks')
        class ActiveString(str):
            pass
        for value in (Active(context('training-ui')), {**context('training-ui'), 1: 'bad'},
                      {**context('training-ui'), 'source_identity': ActiveString('source.' + 'b' * 64)}):
            with self.subTest(type=type(value).__name__), self.assertRaises(ValueError):
                operator.reviewed_context(value)

    def test_malformed_ids_hashes_phase_and_source_identity_are_refused(self):
        for field, value in (('run_id', '../outside'), ('run_id', 'A' * 32), ('run_id', True),
                             ('phase', []), ('git_sha256', 'X' * 64), ('application_sha256', 'a' * 63),
                             ('input_manifest_sha256', None), ('source_identity', 'source.' + 'a' * 65)):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                operator.reviewed_context({**context('training-ui'), field: value})

    def test_git_is_only_a_canonical_local_git_identity_not_code_or_path_injection(self):
        for path in ('git.exe', r'\\server\git.exe', r'C:\bad\..\git.exe', r'C:\NUL\git.exe',
                     r'C:\one;C:\other\git.exe', r'C:\bad";import\git.exe', 'C:\\bad\n\\git.exe',
                     r'C:\tools\node.exe', r'C:\tools\git.exe '):
            with self.subTest(path=path), self.assertRaises(ValueError):
                operator.reviewed_context({**context('training-ui'), 'git_executable': path})

    def test_unknown_or_changed_template_marker_refuses_rendering(self):
        with tempfile.TemporaryDirectory(prefix='training-template-') as temporary:
            folder = Path(temporary).resolve()
            for name in operator.FILES:
                (folder / name).write_text('export const inert=true;\n' if name == 'package-tree.mjs' else operator.MARKER)
            with patch.object(operator, 'TEMPLATES', folder):
                self.assertEqual(set(operator.render_training_operator(context('training-input-create'))), set(operator.FILES))
                target = folder / 'global-setup.mjs'
                target.write_text(operator.MARKER + operator.MARKER)
                with self.assertRaises(ValueError):
                    operator.render_training_operator(context('training-input-create'))
                target.write_bytes(b'x' * (512 * 1024 + 1))
                with self.assertRaises(ValueError):
                    operator.render_training_operator(context('training-input-create'))

    def test_every_actual_rendered_module_has_valid_installed_node_syntax(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Existing Node is required; never install it in a test')
        with tempfile.TemporaryDirectory(prefix='training-syntax-') as temporary:
            for phase in operator.PHASES:
                directory = Path(temporary) / phase
                directory.mkdir()
                for name, raw in operator.render_training_operator(context(phase)).items():
                    file = directory / name
                    file.write_bytes(raw)
                    result = subprocess.run([node, '--check', str(file)], timeout=15, capture_output=True)
                    self.assertEqual(result.returncode, 0, result.stderr.decode('utf8', errors='replace')[-2000:])

    def test_unbound_templates_refuse_before_actual_readiness_package_or_ui_setup(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        for name, arguments in (('global-setup.mjs', ['--inspect-prerequisites']),
                                ('offline-package.mjs', []), ('playwright.config.mjs', [])):
            result = subprocess.run([node, str(operator.TEMPLATES / name), *arguments],
                                    timeout=15, capture_output=True, text=True, encoding='utf8')
            self.assertNotEqual(result.returncode, 0)
            if name != 'playwright.config.mjs':
                facts = json.loads(result.stderr)
                self.assertEqual(facts['stage'], 'admission')
                self.assertEqual(facts['status'], 'unavailable')
                self.assertFalse(facts['accuracyExecuted'])
            else:
                self.assertIn('The fixed training UI configuration is unavailable.', result.stderr)

    def test_rendered_ui_definitions_use_current_run_one_case_and_unchanged_limits(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        with tempfile.TemporaryDirectory(prefix='training-definitions-') as temporary:
            folder = Path(temporary).resolve()
            for name, raw in operator.render_training_operator(context('training-ui')).items():
                (folder / name).write_bytes(raw)
            # Import definitions only; the installed-path launch guard is not called.
            script = """import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const m=await import(pathToFileURL(process.argv[2]).href);
const root=path.resolve(process.argv[3]);const p=m.fixedTrainingUiPaths(root);
const c=m.fixedTrainingUiConfig(root,p.setup);
assert.equal(c.workers,1);assert.equal(c.retries,0);assert.equal(c.timeout,600000);
assert.equal(c.projects.length,1);assert.equal(c.projects[0].name,'packaged-desktop');
assert.equal(c.testMatch,'packaged-desktop-operational-ui.e2e.spec.ts');
assert.equal(p.caseRun,'training-ui-'+('a'.repeat(32))+'-01');
assert.equal(p.packageRoot,path.join(root,'.local-codex/q/aaaaaaaa/o/ai-system-builder-win32-x64'));
assert.equal(p.setup,path.join(root,'.local-codex/native-training-host-operator/v2', 'a'.repeat(32),'training-ui/global-setup.mjs'));
assert.equal(m.trainingReadOnlyArguments(['-m','pip','install','bad'],new Map()),false);
console.log('fixed-ui-definitions-only');"""
            result = subprocess.run([node, '--input-type=module', '-e', script, 'inert-definition-test', str(folder / 'global-setup.mjs'), str(folder)],
                                    timeout=15, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr[-2000:])
            self.assertEqual(result.stdout.strip(), 'fixed-ui-definitions-only')

    def test_rendered_input_hash_mismatch_denies_before_any_probe_or_package_read(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        for phase in ('training-readiness', 'training-package'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory(prefix='tc-') as temporary:
                root = Path(temporary).resolve()
                facts = context(phase)
                helpers = root / operator.operator_relative(facts)
                helpers.mkdir(parents=True)
                for name, raw in operator.render_training_operator(facts).items():
                    (helpers / name).write_bytes(raw)
                run = root / '.local-codex/native-training-host-v1/runs' / facts['run_id']
                folder = run / phase
                folder.mkdir(parents=True)
                candidate = root / '.local-codex/q/aaaaaaaa/c'
                candidate.mkdir(parents=True)
                # No runtime or build inputs exist. A broken guard cannot train
                # or load Forge; the red fixture exposes only premature staging.
                self.assertFalse((root / 'artifacts').exists())
                env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'PATH') if key in os.environ}
                env.update({key: '1' for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_DATASETS_OFFLINE',
                    'PIP_NO_INDEX', 'PIP_REQUIRE_HASHES', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', 'ELECTRON_SKIP_BINARY_DOWNLOAD')})
                env.update({'AISB_LOCAL_TRAINING_UI_RUN': str(run), 'PYTHON_RUNTIME_QUALIFICATION_SCENARIO': 'training-model-host',
                    'VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION': '.local-codex/training-inputs/tiny-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/input.json',
                    'VISUAL_COMPOSER_TRAINING_INPUT_SHA256': 'd' * 64, 'NODE_OPTIONS': ''})
                arguments = [str(helpers / 'global-setup.mjs'), '--inspect-prerequisites'] if phase == 'training-readiness' else [str(helpers / 'offline-package.mjs')]
                result = subprocess.run([node, *arguments], cwd=folder if phase == 'training-readiness' else candidate,
                                        env=env, timeout=15, capture_output=True, text=True, encoding='utf8')
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(result.stderr.lstrip().startswith('{"schemaVersion":'), result.stderr[-1800:])
                report = json.loads(result.stderr)
                self.assertEqual(report['stage'], 'admission')
                self.assertEqual(report['status'], 'unavailable')
                self.assertFalse((folder / 'readiness-probes.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
