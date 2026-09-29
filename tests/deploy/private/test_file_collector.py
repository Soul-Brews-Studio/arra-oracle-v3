import tempfile
import unittest
import importlib.util
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'
import sys
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('collector', ROOT / 'collector.py')
collector = importlib.util.module_from_spec(spec); spec.loader.exec_module(collector)


class CollectorTest(unittest.TestCase):
    def test_transport_does_not_require_local_database(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as state:
            Path(root, 'note.txt').write_text('collector test', encoding='utf-8')
            old = Path(state, 'inventory'); old.mkdir()
            old.chmod(0o700)
            with gzip.open(old / 'old.jsonl.gz', 'wt') as stream:
                stream.write(json.dumps({'status': 'discovered', 'path': 'missing.txt'}) + '\n')
            Path(state, 'transport-checkpoint.json').write_text(json.dumps({'snapshot': 'old.jsonl.gz', 'line': 100, 'sent': 100}))
            sent = []
            result = collector.collect(root, 'mac', 'volume', state, transport=lambda payload, device: sent.append((payload, device)))
            self.assertEqual(result['sent'], 1)
            self.assertEqual(sent[0][1], 'mac')
            self.assertEqual(sent[0][0]['content'], 'collector test')


if __name__ == '__main__':
    unittest.main()
