import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'
import sys
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('received', ROOT / 'received.py')
received = importlib.util.module_from_spec(spec); spec.loader.exec_module(received)


class ReceivedTest(unittest.TestCase):
    def test_import_is_idempotent_and_bad_payload_is_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'received'; root.mkdir()
            payload = {'record': {'device': 'mac', 'volume': 'v', 'source_id': 's', 'path': 'note.txt', 'size': 4, 'mtime_ns': 1, 'format': 'text', 'status': 'extracted'}, 'content': 'word'}
            import hashlib
            raw = json.dumps(payload, separators=(',', ':')).encode()
            (root / (hashlib.sha256(raw).hexdigest() + '.received')).write_bytes(raw)
            (root / ('bad' * 16 + '.received')).write_bytes(b'bad')
            first = received.import_received(root, Path(folder) / 'files.db')
            second = received.import_received(root, Path(folder) / 'files.db')
            self.assertEqual(first, {'imported': 1, 'rejected': 1})
            self.assertEqual(second, {'imported': 0, 'rejected': 0})
            self.assertTrue(list(root.glob('*.rejected')))


if __name__ == '__main__':
    unittest.main()
