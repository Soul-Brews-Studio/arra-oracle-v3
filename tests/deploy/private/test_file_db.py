import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion/filedb.py'
spec = importlib.util.spec_from_file_location('filedb', MODULE)
filedb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(filedb)


class FileDbTest(unittest.TestCase):
    def test_upsert_search_read_status_and_idempotence(self):
        with tempfile.TemporaryDirectory() as folder:
            db = filedb.FileDb(Path(folder) / 'files.db')
            self.assertEqual((Path(folder) / 'files.db').stat().st_mode & 0o777, 0o600)
            record = {'device': 'mac', 'volume': 'v', 'source_id': 'source', 'path': 'docs/note.md',
                      'size': 11, 'mtime_ns': 1, 'format': 'text', 'status': 'extracted'}
            identifier = db.upsert(record, 'Arra deployment decision', {'page': 3})
            self.assertEqual(db.upsert(record, 'Arra deployment decision', {'page': 3}), identifier)
            hits = db.search('deployment', limit=30, device='mac', path='docs')
            self.assertEqual(len(hits), 1)
            self.assertEqual(hits[0]['preview'], 'Arra deployment decision')
            self.assertEqual(db.read(identifier, limit=4)['next_offset'], 4)
            db.record_scan('scan', 'mac', 'v', True, {'extracted': 1})
            self.assertEqual(db.status()['counts'], {'extracted': 1})
            db.close()

    def test_secret_quarantine_is_still_searchable_only_by_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            db = filedb.FileDb(Path(folder) / 'files.db')
            identifier = db.upsert({'device': 'mint', 'volume': 'v', 'source_id': 's', 'path': 'secret.txt',
                                    'size': 1, 'mtime_ns': 1, 'format': 'text', 'status': 'quarantined',
                                    'reason': 'secret_detected'}, '')
            self.assertEqual(db.search('secret')[0]['status'], 'quarantined')
            self.assertEqual(db.read(identifier)['excerpt'], '')

    def test_changed_content_removes_stale_vector(self):
        with tempfile.TemporaryDirectory() as folder:
            db = filedb.FileDb(Path(folder) / 'files.db')
            record = {'device': 'mac', 'volume': 'v', 'source_id': 'source', 'path': 'note.md',
                      'size': 5, 'mtime_ns': 1, 'format': 'text', 'status': 'extracted', 'sha256': 'a'}
            identifier = db.upsert(record, 'hello')
            db.db.execute('INSERT INTO file_vectors VALUES (?,?,?,?)', (identifier, '[]', 'bge-m3', 0)); db.db.commit()
            db.upsert({**record, 'sha256': 'b', 'mtime_ns': 2}, 'changed')
            self.assertEqual(db.db.execute('SELECT count(*) FROM file_vectors').fetchone()[0], 0)
            db.close()

    def test_reconcile_removes_only_stale_source_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            db = filedb.FileDb(Path(folder) / 'files.db')
            base = {'device': 'mint', 'volume': 'v', 'size': 1, 'mtime_ns': 1,
                    'format': 'text', 'status': 'extracted'}
            db.upsert({**base, 'source_id': 'keep', 'path': 'keep'}, 'a')
            db.upsert({**base, 'source_id': 'drop', 'path': 'drop'}, 'b')
            self.assertEqual(db.reconcile('mint', 'v', {'keep'}), 1)
            self.assertEqual(db.db.execute('SELECT count(*) FROM files').fetchone()[0], 1)
            db.close()


if __name__ == '__main__':
    unittest.main()
