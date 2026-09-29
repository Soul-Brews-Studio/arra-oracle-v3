import importlib.util
import base64
import hashlib
import json
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion/transport.py'
spec = importlib.util.spec_from_file_location('transport', MODULE)
transport = importlib.util.module_from_spec(spec); spec.loader.exec_module(transport)


class TransportTest(unittest.TestCase):
    def test_frames_are_bounded_replayable_and_hash_bound(self):
        payload = {'record': {'device': 'mac', 'path': 'note.txt'}, 'content': 'synthetic'}
        result = list(transport.frames(payload, 'mac'))
        self.assertEqual(result[0]['op'], 'begin')
        self.assertEqual(result[-1]['op'], 'commit')
        body = b''.join(base64.b64decode(frame['data']) for frame in result[1:-1])
        self.assertEqual(len(body), result[0]['size'])
        self.assertEqual(hashlib.sha256(body).hexdigest(), result[0]['object'])
        self.assertEqual(result[0]['object'], result[-1]['object'])
        self.assertEqual(result[1]['offset'], 0)


if __name__ == '__main__':
    unittest.main()
