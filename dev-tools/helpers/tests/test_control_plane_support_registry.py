"""Bounded review-registry routing runs its complete related consumers only."""
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class SupportRegistryRoutingTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[3]

    def select(self, paths, root=None, required=None):
        return {c['id']:c for c in catalog.plan(root or self.root,paths,required or ['control-plane'],'a'*64)['selected']}

    def test_closed_source_scope_executes_every_registry_and_projection_consumer_module(self):
        checks=self.select(list(catalog.SUPPORT_REGISTRY_SCOPE[:4]))
        self.assertEqual(checks['control-plane']['argv'][-2*len(catalog.SUPPORT_REGISTRY_TESTS):],
            [part for name in catalog.SUPPORT_REGISTRY_TESTS for part in ('-k',name)])
        self.assertNotIn('test:all',' '.join(checks['control-plane']['argv']))

    def test_fixed_part_metadata_receives_the_same_related_check(self):
        checks=self.select(['docs/operations/roadmap-supporting-work/links-0001.json'])
        self.assertIn('test_control_plane_supporting_work.',checks['control-plane']['argv'])

    def test_empty_unknown_mixed_and_explicit_generic_focus_preserve_fallback(self):
        for paths in ([],['docs/operations/roadmap-supporting-work/links-0017.json'],
            [catalog.SUPPORT_REGISTRY_SCOPE[0],'dev-tools/helpers/control_plane/work.py']):
            self.assertNotIn('test_control_plane_supporting_work.',self.select(paths)['control-plane']['argv'])
        checks=self.select([catalog.SUPPORT_REGISTRY_SCOPE[0]],required=['control-plane','focused-tests'])
        self.assertNotIn('test_control_plane_supporting_work.',checks['control-plane']['argv'])

    def test_missing_required_consumer_preserves_the_complete_controller_fallback(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            for source in set(catalog.SUPPORT_REGISTRY_REQUIRED):
                if source.endswith('test_control_plane_site.py'):continue
                target=root/source;target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes((self.root/source).read_bytes())
            self.assertNotIn('test_control_plane_supporting_work.',self.select([catalog.SUPPORT_REGISTRY_SCOPE[0]],root)['control-plane']['argv'])


if __name__=='__main__':unittest.main()
