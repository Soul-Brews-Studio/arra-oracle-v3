import base64
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
import io
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'))
from receiver import accept, serve


class ReceiverTest(unittest.TestCase):
    def test_protocol_rejects_shell_command_and_oversized_frame(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                serve(Path(directory), 'mac', io.BytesIO(), io.StringIO(), 'sh')
            output = io.StringIO()
            serve(Path(directory), 'mac', io.BytesIO(b'x' * (2 * 1024**2 + 1)), output, '')
            self.assertIn('rejected', output.getvalue())
            self.assertFalse((Path(directory) / 'mac').exists())

    def test_verified_chunk_retry_and_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = b'synthetic transfer'
            digest = hashlib.sha256(payload).hexdigest()
            start = {'op': 'begin', 'device': 'mac', 'object': digest, 'size': len(payload)}
            self.assertEqual(accept(root, 'mac', start, floor=0)['offset'], 0)
            chunk = dict(start, op='chunk', offset=0,
                         data=base64.b64encode(payload).decode(), checksum=digest)
            self.assertEqual(accept(root, 'mac', chunk, floor=0)['offset'], len(payload))
            self.assertEqual(accept(root, 'mac', chunk, floor=0)['offset'], len(payload))
            self.assertEqual(accept(root, 'mac', dict(start, op='commit'), floor=0)['status'], 'received')
            self.assertEqual((root / 'mac' / (digest + '.received')).read_bytes(), payload)

    def test_serve_closes_after_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            payload = b'close after commit'
            digest = hashlib.sha256(payload).hexdigest()
            frames = [
                {'op': 'begin', 'device': 'mac', 'object': digest, 'size': len(payload)},
                {'op': 'chunk', 'device': 'mac', 'object': digest, 'offset': 0,
                 'data': base64.b64encode(payload).decode(), 'checksum': digest},
                {'op': 'commit', 'device': 'mac', 'object': digest},
                {'op': 'begin', 'device': 'mac', 'object': digest, 'size': len(payload)},
            ]
            output = io.StringIO()
            serve(Path(directory), 'mac', io.BytesIO(('\n'.join(json.dumps(frame) for frame in frames) + '\n').encode()), output, '')
            self.assertEqual(len(output.getvalue().splitlines()), 3)

    def test_device_mismatch_traversal_and_bad_hash_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for frame in [
                {'op': 'begin', 'device': 'acer', 'object': 'a'*64, 'size': 1},
                {'op': 'begin', 'device': 'mac', 'object': '../escape', 'size': 1},
                {'op': 'begin', 'device': 'mac', 'object': 'a'*64, 'size': -1},
            ]:
                with self.assertRaises(ValueError):
                    accept(root, 'mac', frame, floor=0)
            accept(root, 'mac', {'op': 'begin', 'device': 'mac', 'object': 'a'*64, 'size': 1}, floor=0)
            with self.assertRaises(ValueError):
                accept(root, 'mac', {'op': 'chunk', 'device': 'mac', 'object': 'a'*64,
                                    'offset': 0, 'data': 'eA==', 'checksum': 'b'*64}, floor=0)


if __name__ == '__main__':
    unittest.main()
