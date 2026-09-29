import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import io
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'
import sys
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('embed', ROOT / 'embed.py')
embed = importlib.util.module_from_spec(spec); spec.loader.exec_module(embed)


class EmbedTest(unittest.TestCase):
    def test_batch_dimension_and_semantic_result(self):
        with tempfile.TemporaryDirectory() as folder:
            db = sqlite3.connect(Path(folder) / 'files.db')
            db.executescript('CREATE TABLE files(id TEXT PRIMARY KEY,device TEXT,volume TEXT,path TEXT,size INTEGER,mtime_ns INTEGER,format TEXT,status TEXT,reason TEXT,sha256 TEXT,content TEXT,provenance TEXT,indexed_at INTEGER); CREATE TABLE file_vectors(id TEXT PRIMARY KEY,vector TEXT,model TEXT,dimensions INTEGER);')
            db.execute('INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ('a','mac','v','note',1,1,'text','extracted',None,None,'semantic note','{}',1)); db.execute('INSERT INTO file_vectors VALUES (?,?,?,?)', ('a',json.dumps([1.0]+[0.0]*1023),'bge-m3',1024)); db.commit(); db.close()
            with patch.object(embed, 'embed', return_value=[[1.0]+[0.0]*1023]):
                self.assertEqual(embed.embed_pending(Path(folder) / 'files.db')['embedded'], 0)
                result = embed.semantic_search(Path(folder) / 'files.db', 'paraphrase')
            self.assertEqual(result[0]['id'], 'a')
            self.assertEqual(result[0]['score'], 1.0)

    def test_invalid_dimension_is_rejected(self):
        with patch('urllib.request.urlopen') as opener:
            opener.return_value.__enter__.return_value = io.StringIO('{"embeddings":[[0]]}')
            with self.assertRaises(ValueError):
                embed.embed(['x'])


if __name__ == '__main__':
    unittest.main()
