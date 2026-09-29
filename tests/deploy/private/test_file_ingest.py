import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'
import sys
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('ingest', ROOT / 'ingest.py')
ingest = importlib.util.module_from_spec(spec); spec.loader.exec_module(ingest)


class IngestTest(unittest.TestCase):
    def test_checkpoint_and_changed_file_outcome(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder); root = base / 'root'; root.mkdir()
            source = root / 'note.txt'; source.write_text('hello')
            snapshot = base / 'snapshot.jsonl.gz'
            with gzip.open(snapshot, 'wt') as stream:
                stream.write(json.dumps({'device': 'mac', 'volume': 'v', 'path': 'note.txt', 'source_id': 's', 'size': 5, 'mtime_ns': source.stat().st_mtime_ns, 'status': 'discovered'}) + '\n')
            result = ingest.run(snapshot, root, base / 'files.db', base / 'state')
            self.assertEqual(result['processed'], 1)
            self.assertTrue((base / 'state/checkpoint.json').exists())
            self.assertTrue(ingest.run(snapshot, root, base / 'files.db', base / 'state')['processed'] == 0)


if __name__ == '__main__':
    unittest.main()
