"""Approved Context checks cover owned work without claiming unrelated sources."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class ContextExecutionRoutingTests(unittest.TestCase):
    def selected(self, paths, required):
        return {row['id']: row for row in catalog.plan(HELPERS.parents[1], paths, required, 'b' * 64)['selected']}

    def test_installed_query_worker_is_fixed_exact_python_and_shared_model_only_keeps_fallback(self):
        name = 'headless-context-installed-query-worker'
        definition = catalog.PUBLISHED_FORM_CHECKS[name]
        selected = self.selected(list(definition['sources']), ['architecture'])
        self.assertEqual(definition['interpreter'], 'python')
        self.assertEqual(selected[name]['argv'], [sys.executable, '-B', '-u', '-m', 'unittest', '-v',
            'modules.adapters.runtime.python.worker.tests.test_context_artifact_operation',
            'modules.adapters.runtime.python.worker.tests.test_context_generation'])
        self.assertNotIn('focused-tests', selected)
        self.assertIn('focused-tests', self.selected(list(definition['sources']), ['architecture', 'focused-tests']))
        self.assertIn('focused-tests', self.selected(list(definition['sources']) + [
            'modules/adapters/runtime/python/worker/tasks/unmapped-context-query.py'], ['architecture']))
        model_only = self.selected(['modules/adapters/runtime/python/worker/models.py'], ['architecture'])
        self.assertNotIn(name, model_only)
        self.assertIn('focused-tests', model_only)
        lifecycle = self.selected(list(catalog.PUBLISHED_FORM_CHECKS['headless-context-artifact-lifecycle']['sources']), ['architecture'])
        self.assertEqual(lifecycle['headless-context-artifact-lifecycle']['argv'][0], 'node')

    def test_rebuild_inputs_bind_exact_metadata_and_real_composed_consumers_without_generic_coverage_loss(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-rebuild-inputs']
        paths = list(definition['sources'])
        selected = self.selected(paths, ['architecture'])
        self.assertNotIn('focused-tests', selected)
        self.assertEqual(selected['headless-context-rebuild-inputs']['argv'][1:], [
            '--import', 'tsx', '--test', '--',
            'modules/contracts/headless/tests/headless-context-rebuild.unit.test.ts',
            'modules/application/use-cases/context-management/tests/headless-context-rebuild.unit.test.ts',
            'modules/adapters/persistence/system-builder/tests/structured-headless-context-plan-task-store.unit.test.ts',
            'modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts',
            'dev-tools/scripts/agent-support/tests/headless-plan-skill.unit.test.ts'])
        self.assertNotIn('headless-data-desktop-plan-qualification', selected)
        self.assertIn('focused-tests', self.selected(paths, ['architecture', 'focused-tests']))
        self.assertIn('focused-tests', self.selected(paths + [
            'modules/hosts/shared/composition/unmapped-rebuild-inputs.ts'], ['architecture']))
        host_only = self.selected(['modules/hosts/desktop/composition/composeDesktopHost.ts'], ['architecture'])
        self.assertNotIn('headless-context-rebuild-inputs', host_only)
        self.assertIn('focused-tests', host_only)

    def test_artifact_lifecycle_checks_exact_adapter_and_existing_consumer_without_masking_unknown_sources(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-artifact-lifecycle']
        paths = list(definition['sources'])
        selected = self.selected(paths, ['architecture'])
        self.assertNotIn('focused-tests', selected)
        self.assertEqual(selected['headless-context-artifact-lifecycle']['argv'][1:], [
            '--import', 'tsx', '--test', '--',
            'modules/adapters/runtime/python/context-management/tests/createPythonContextArtifactRuntimeAdapter.unit.test.ts',
            'modules/application/services/runtime/tests/owned-task-reconciler.service.unit.test.ts',
            'modules/application/use-cases/context-management/tests/context-browser.use-cases.unit.test.ts'])
        self.assertIn('focused-tests', self.selected(paths, ['architecture', 'focused-tests']))
        self.assertIn('focused-tests', self.selected(paths + [
            'modules/adapters/runtime/python/context-management/unmapped-operation.ts'], ['architecture']))
        host_only = self.selected(['modules/hosts/server/composition/composeServerHost.ts'], ['architecture'])
        self.assertNotIn('headless-context-artifact-lifecycle', host_only)
        self.assertIn('focused-tests', host_only)

    def test_public_result_save_automatically_checks_finite_contract_metadata_and_real_core_host_composition(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-result-save-contract']
        paths = list(definition['sources'])
        selected = self.selected(paths, ['architecture'])
        self.assertNotIn('focused-tests', selected)
        self.assertEqual(selected['headless-context-result-save-contract']['argv'][1:], [
            '--import', 'tsx', '--test', '--',
            'modules/contracts/headless/tests/headless-context-result-plan.unit.test.ts',
            'modules/application/use-cases/context-management/tests/headless-context-saved.unit.test.ts',
            'modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts'])
        self.assertIn('focused-tests', self.selected(paths, ['architecture', 'focused-tests']))
        self.assertIn('focused-tests', self.selected(paths + [
            'modules/application/use-cases/context-management/unmapped-saved-context.ts'], ['architecture']))
        self.assertNotIn('headless-context-result-save-contract', self.selected([
            'modules/contracts/headless/index.ts'], ['architecture']))

    def test_result_byte_checks_cover_only_exact_publication_sources_and_existing_ingestion(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-result-bytes']
        paths = list(definition['sources'])
        selected = self.selected(paths, ['architecture'])
        self.assertNotIn('focused-tests', selected)
        self.assertEqual(selected['headless-context-result-bytes']['argv'][1:], [
            '--import', 'tsx', '--test', '--',
            'modules/adapters/storage/filesystem/artifact-store/tests/context-result-byte-storage.integration.test.ts',
            'modules/adapters/storage/filesystem/artifact-store/tests/ingestion-file-byte-storage.integration.test.ts'])
        self.assertIn('focused-tests', self.selected(paths + [
            'modules/adapters/storage/filesystem/artifact-store/unmapped-context-publication.ts'], ['architecture']))
        self.assertIn('focused-tests', self.selected(paths, ['architecture', 'focused-tests']))
        index_only = self.selected(['modules/adapters/storage/filesystem/artifact-store/index.ts'], ['architecture'])
        self.assertNotIn('headless-context-result-bytes', index_only)
        self.assertIn('focused-tests', index_only)

    def test_bootstrap_save_capability_uses_actual_server_factory_and_bounded_vitest_collection(self):
        path = 'modules/hosts/shared/composition/tests/headless-context-result-bootstrap.unit.test.ts'
        selected = self.selected([path, 'apps/server/src/createServer.ts'], ['architecture'])
        self.assertNotIn('focused-tests', selected)
        self.assertEqual(selected['headless-context-result-save-bootstrap']['argv'][1:], [
            'dev-tools/helpers/run_vitest_checks.mjs', '--', path])
        self.assertIn('focused-tests', self.selected([path], ['architecture', 'focused-tests']))
        self.assertIn('focused-tests', self.selected([path, 'apps/server/src/unmapped-bootstrap.ts'], ['architecture']))

    def test_result_save_checks_bind_internal_owner_metadata_and_related_publication_only(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-result-save-owner']
        paths = list(definition['sources'])
        selected = self.selected(paths, ['architecture'])
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-result-save-owner']['argv']
        for filename in ['context-approved-start.unit.test.ts', 'structured-headless-context-result-store.unit.test.ts',
                         'context-result-byte-storage.integration.test.ts']:
            self.assertTrue(any(value.endswith('/' + filename) for value in command), filename)
        self.assertNotIn('--suite=all', command)
        self.assertIn('focused-tests', self.selected(paths + ['modules/hosts/shared/composition/unmapped-context-result.ts'], ['architecture']))
        self.assertIn('focused-tests', self.selected(paths, ['architecture', 'focused-tests']))
        host_only = self.selected(['modules/hosts/desktop/composition/composeDesktopArtifactFeature.ts'], ['architecture'])
        self.assertNotIn('headless-context-result-save-owner', host_only)
        self.assertIn('focused-tests', host_only)

    def test_explicit_desktop_approval_owner_executes_existing_connection_and_scope_regressions(self):
        path = 'modules/hosts/desktop/composition/composeDesktopHeadlessPlanApprovals.ts'
        selected = self.selected([path], ['headless-data-task-status'])
        self.assertNotIn('focused-tests', selected)
        self.assertIn('modules/hosts/desktop/composition/tests/desktop-headless-connection.unit.test.ts',
            selected['headless-data-task-status']['argv'])
        self.assertIn('focused-tests', self.selected([path, 'modules/hosts/desktop/composition/unmapped-approval.ts'],
            ['headless-data-task-status']))
        self.assertIn('focused-tests', self.selected([path], ['headless-data-task-status', 'focused-tests']))

    def test_model_reference_checks_cover_exact_internal_sources_without_masking_unknown_work(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-model-reference']
        paths = list(definition['sources'])
        selected = self.selected(paths, ['headless-context-owned-start'])
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-model-reference']['argv']
        self.assertTrue(any(value.endswith('/approved-context-model-reference.unit.test.ts') for value in command))
        self.assertTrue(any(value.endswith('/context-embedding-model-files.unit.test.ts') for value in command))
        self.assertEqual(selected['headless-context-model-worker']['argv'], [sys.executable, '-B', '-m', 'unittest', '-v',
            'modules.adapters.runtime.python.worker.tests.test_context_generation.ContextGenerationTests'])
        self.assertIn('focused-tests', self.selected(paths + ['modules/adapters/model/local/unknown-context-model.ts'],
            ['headless-context-owned-start']))
        self.assertIn('focused-tests', self.selected(paths, ['headless-context-owned-start', 'focused-tests']))
        # A shared worker DTO edit alone cannot borrow this model feature's source declaration.
        worker_only = self.selected(['modules/adapters/runtime/python/worker/models.py'], ['architecture'])
        self.assertNotIn('headless-context-model-reference', worker_only)
        self.assertIn('focused-tests', worker_only)

    def test_required_pack_contract_executes_accepted_task_store_owner_and_approval_regressions(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-pack-contract']
        selected = self.selected(list(definition['sources']), ['headless-context-pack-contract'])
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-pack-contract']['argv']
        for filename in ['headless-context-plan.unit.test.ts', 'headless-context-task.unit.test.ts',
                         'context-approved-start.unit.test.ts', 'structured-headless-context-plan-task-store.unit.test.ts',
                         'headless-context-execution.unit.test.ts', 'HeadlessPlanApprovalDialog.interaction.ui.test.tsx',
                         'headless-dataset-plan.unit.test.ts', 'headless-dataset-result-plan.unit.test.ts']:
            self.assertTrue(any(value.endswith('/' + filename) for value in command), filename)
        self.assertNotIn('--suite=all', command)
        self.assertIn('modules/adapters/persistence/system-builder/README.md', definition['sources'])
        self.assertIn('focused-tests', self.selected([
            'modules/adapters/persistence/system-builder/unmapped-context.ts'], ['headless-context-pack-contract']))
        self.assertIn('focused-tests', self.selected(list(definition['sources']),
            ['headless-context-pack-contract', 'focused-tests']))
        self.assertIn('focused-tests', self.selected(list(definition['sources']) +
            ['modules/application/use-cases/context-management/unmapped-execution.ts'], ['headless-context-pack-contract']))

    def test_browser_companion_requires_primary_selection_and_keeps_unknown_and_explicit_fallback(self):
        paths = list(catalog.PUBLISHED_FORM_CHECKS['headless-context-pack-browser']['sources'])
        selected = self.selected(paths, ['headless-context-pack-contract'])
        self.assertNotIn('focused-tests', selected)
        self.assertEqual(selected['headless-context-pack-browser']['argv'][1:],
            ['dev-tools/helpers/run_vitest_checks.mjs', '--',
             'apps/thin-client/src/features/workspace/api/tests/managed-browser-plan-approval.unit.test.ts'])
        self.assertIn('focused-tests', self.selected(paths, ['architecture']))
        self.assertIn('focused-tests', self.selected(paths +
            ['apps/thin-client/src/features/workspace/api/unknown-context.ts'], ['headless-context-pack-contract']))
        self.assertIn('focused-tests', self.selected(paths, ['headless-context-pack-contract', 'focused-tests']))

    def test_worker_attribution_check_is_fixed_model_free_and_keeps_unknown_fallback(self):
        path = 'modules/adapters/runtime/python/worker/tasks/context_generation.py'
        selected = self.selected([path], ['headless-context-pack-contract'])
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-pack-worker']['argv']
        self.assertEqual(command[:5], [sys.executable, '-B', '-m', 'unittest', '-v'])
        self.assertEqual(len(command), 7)
        self.assertTrue(command[5].endswith('.test_source_pack_preserves_recorded_terms_in_inspection_and_archive_without_models'))
        self.assertTrue(command[6].endswith('.test_recorded_rag_terms_respect_attribution_selection_before_embedding'))
        self.assertIn('focused-tests', self.selected([path], ['headless-context-pack-contract', 'focused-tests']))
        self.assertIn('focused-tests', self.selected([path.replace('context_generation.py', 'unknown_context.py')],
            ['headless-context-pack-contract']))
