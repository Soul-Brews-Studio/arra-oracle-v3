import importlib.util
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest

BUNDLE = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'
sys.path.insert(0, str(BUNDLE))
spec = importlib.util.spec_from_file_location('snapshot', BUNDLE / 'snapshot.py')
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotTest(unittest.TestCase):
    def test_complete_private_snapshot_and_aggregate_counts(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = base / 'input'
            root.mkdir()
            (root / 'note.txt').write_text('synthetic')
            result = snapshot.capture(root, 'mac', 'v', base / 'state', floor=0)
            self.assertTrue(result['complete'])
            self.assertEqual(result['counts'], {'discovered': 1})
            self.assertEqual(result['source_bytes'], 9)
            self.assertNotIn('note.txt', json.dumps(result))
            self.assertEqual((base / 'state').stat().st_mode & 0o777, 0o700)
            with gzip.open(next((base / 'state').glob('*.jsonl.gz')), 'rt') as stream:
                records = [json.loads(line) for line in stream]
            self.assertEqual(records[0]['path'], 'note.txt')

    def test_capacity_stop_does_not_publish_successful_scan(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = base / 'input'
            root.mkdir()
            (root / 'note').write_text('synthetic')
            result = snapshot.capture(root, 'mint', 'v', base / 'state', floor=10**20)
            self.assertFalse(result['complete'])
            self.assertEqual(result['reason'], 'capacity')
            self.assertFalse((base / 'state/latest.json').exists())

    def test_existing_lock_prevents_concurrent_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            state = base / 'state'
            state.mkdir(mode=0o700)
            (state / 'lock').mkdir()
            with self.assertRaises(FileExistsError):
                snapshot.capture(base, 'mac', 'v', state, floor=0)


if __name__ == '__main__':
    unittest.main()
