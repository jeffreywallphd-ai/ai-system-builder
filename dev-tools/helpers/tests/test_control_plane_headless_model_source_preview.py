"""Bounded source preview uses exact Model/host/MCP evidence, not model execution."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelSourcePreviewRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    owner = 'modules/application/use-cases/model/headless-model-source-preview.use-case.ts'

    def selected(self, paths, required=('headless-model-metadata-owner-unit',)):
        return {row['id']: row for row in catalog.plan(self.root, paths, list(required), 'f' * 64)['selected']}

    def test_exact_source_owner_includes_provider_authority_host_and_native_pairing_regressions(self):
        rows = self.selected([self.owner, 'apps/desktop/src/main/index.ts',
                              'modules/hosts/shared/composition/headlessModelSourcePreview.ts'])
        self.assertNotIn('focused-tests', rows)
        command = rows['headless-model-metadata-owner-unit']['argv']
        for name in ['modules/contracts/headless/tests/headless-model-source-preview.unit.test.ts',
                     'modules/application/use-cases/model/tests/headless-model-source-preview.unit.test.ts',
                     'modules/hosts/shared/composition/tests/headless-model-source-preview.unit.test.ts',
                     'modules/adapters/model/huggingface/tests/model-download-source.unit.test.ts',
                     'apps/desktop/src/main/tests/desktop-headless-pairing-ipc.unit.test.ts']:
            self.assertIn(name, command)
        self.assertIn('headless-model-metadata-owner-types', rows)
        self.assertNotIn('completion-all', rows)

    def test_unknown_and_explicit_generic_checks_remain_and_shared_main_alone_is_not_borrowed(self):
        self.assertIn('focused-tests', self.selected([self.owner], ('focused-tests',)))
        self.assertIn('focused-tests', self.selected([self.owner, 'modules/hosts/shared/composition/unmapped-source-owner.ts']))
        rows = self.selected(['apps/desktop/src/main/index.ts'], ('documentation',))
        self.assertNotIn('headless-model-metadata-owner-unit', rows)
        self.assertIn('focused-tests', rows)

    def test_explicit_consent_and_read_lifetime_changes_keep_their_owned_feature_checks(self):
        required = ('headless-model-metadata-owner-unit', 'headless-desktop-activation', 'managed-headless-client-policy')
        rows = self.selected([self.owner,
                              'modules/adapters/security/headless/createDesktopHeadlessClientAuthority.ts',
                              'modules/adapters/security/headless/README.md',
                              'modules/adapters/transport/headless-loopback/startDesktopHeadlessLoopback.ts',
                              'modules/hosts/desktop/composition/composeDesktopHeadlessConnection.ts',
                              'modules/hosts/server/security/resolveManagedHeadlessClientPolicy.ts'], required)
        self.assertNotIn('focused-tests', rows)
        desktop = rows['headless-desktop-activation']['argv']
        for name in ['modules/adapters/security/headless/tests/desktop-headless-client-authority.unit.test.ts',
                     'modules/adapters/transport/headless-loopback/tests/desktop-headless-loopback.unit.test.ts',
                     'modules/hosts/desktop/composition/tests/desktop-headless-connection.unit.test.ts']:
            self.assertIn(name, desktop)
        self.assertIn('modules/hosts/server/security/tests/managed-headless-client-policy.unit.test.ts',
                      rows['managed-headless-client-policy']['argv'])
        self.assertNotIn('completion-all', rows)


if __name__ == '__main__':
    unittest.main()
