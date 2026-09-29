"""Inventory safety: exercise real trees without reading file bodies."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion/inventory.py'
spec = importlib.util.spec_from_file_location('inventory', MODULE)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class InventoryTest(unittest.TestCase):
    def test_metadata_only_hidden_unicode_hardlinks_and_exclusions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.notes').mkdir()
            original = root / '.notes/ไทย.txt'
            original.write_text('body must not be collected')
            os.link(original, root / 'duplicate.txt')
            (root / '.ssh').mkdir()
            (root / '.ssh/private').write_text('synthetic excluded')
            (root / '.env').write_text('synthetic excluded')
            (root / 'alias').symlink_to(root, target_is_directory=True)
            records = list(inventory.scan(root, 'mac', 'test-volume'))
            files = {r['path']: r for r in records if 'path' in r}
            self.assertEqual(files['.notes/ไทย.txt']['status'], 'discovered')
            self.assertEqual(files['duplicate.txt']['source_id'],
                             files['.notes/ไทย.txt']['source_id'])
            self.assertEqual(files['alias']['status'], 'excluded_link')
            self.assertNotIn('.ssh/private', files)
            self.assertEqual(files['.ssh']['status'], 'excluded_sensitive')
            self.assertEqual(files['.env']['status'], 'excluded_sensitive')
            self.assertTrue(records[-1]['complete'])
            self.assertNotIn('body must', str(records))

    def test_missing_root_cannot_authorize_deletions(self):
        with tempfile.TemporaryDirectory() as folder:
            records = list(inventory.scan(Path(folder) / 'missing', 'mint', 'v'))
            self.assertFalse(records[-1]['complete'])
            self.assertEqual(records[0]['status'], 'unreadable')

    def test_explicit_exclusion_prunes_own_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'spool').mkdir()
            (root / 'spool/payload').write_text('do not recurse')
            records = list(inventory.scan(root, 'mac', 'v', [root / 'spool']))
            self.assertEqual(records[0]['status'], 'excluded_policy')
            self.assertEqual(len(records), 2)

    def test_root_inside_excluded_tree_is_not_traversed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            child = root / 'private/child'
            child.mkdir(parents=True)
            (child / 'note').write_text('never inventory this')
            records = list(inventory.scan(child, 'mac', 'v', [root / 'private']))
            self.assertEqual(records[0]['status'], 'excluded_policy')
            self.assertEqual(len(records), 2)

    def test_sensitive_ancestor_cannot_be_bypassed_by_selected_root(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / '.ssh/nested'
            root.mkdir(parents=True)
            (root / 'note').write_text('never inventory this')
            records = list(inventory.scan(root, 'mac', 'v'))
            self.assertEqual(records[0]['status'], 'excluded_sensitive')
            self.assertEqual(len(records), 2)

    def test_auth_filename_families_are_excluded(self):
        for name in ['.git-credentials', 'id_ecdsa', 'service-account.json',
                     'oauth.json', '.gemini', '.pi', 'key4.db']:
            with self.subTest(name=name):
                self.assertTrue(inventory.sensitive(name))

    def test_depth_limit_marks_partial_instead_of_exhausting_descriptors(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'a/b/c').mkdir(parents=True)
            records = list(inventory.scan(root, 'mac', 'v', max_depth=2))
            self.assertIn('depth_limit', [r.get('status') for r in records])
            self.assertFalse(records[-1]['complete'])


if __name__ == '__main__':
    unittest.main()
