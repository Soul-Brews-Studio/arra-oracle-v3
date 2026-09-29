import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys

ROOT = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'
sys.path.insert(0, str(ROOT))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


filedb, mcp = load('filedb'), load('mcp')


class McpTest(unittest.TestCase):
    def test_only_three_read_tools_and_limits_are_enforced(self):
        with tempfile.TemporaryDirectory() as folder:
            db = filedb.FileDb(Path(folder) / 'files.db')
            identifier = db.upsert({'device': 'mac', 'volume': 'v', 'source_id': 's', 'path': 'note.txt', 'size': 4, 'mtime_ns': 1, 'format': 'text', 'status': 'extracted'}, 'word')
            listed = mcp.dispatch({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}, db)['result']['tools']
            self.assertEqual([item['name'] for item in listed], ['arra_files_search', 'arra_files_read', 'arra_files_status'])
            read = mcp.dispatch({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'arra_files_read', 'arguments': {'document_id': identifier, 'limit': 999999}}}, db)
            self.assertEqual(json.loads(read['result']['content'][0]['text'])['excerpt'], 'word')
            denied = mcp.dispatch({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'delete', 'arguments': {}}}, db)
            self.assertEqual(json.loads(denied['result']['content'][0]['text'])['error'], 'unknown_tool')
            db.close()


if __name__ == '__main__':
    unittest.main()
