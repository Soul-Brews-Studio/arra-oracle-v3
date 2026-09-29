"""Read-only MCP stdio server for the separate file corpus."""
import json
import os
import sys
from filedb import FileDb
from embed import semantic_search

TOOLS = [
    {'name': 'arra_files_search', 'description': 'Bounded search over the private file corpus.',
     'inputSchema': {'type': 'object', 'properties': {'query': {'type': 'string'}, 'mode': {'enum': ['keyword', 'semantic']}, 'limit': {'type': 'integer'}, 'device': {'type': 'string'}, 'path': {'type': 'string'}, 'format': {'type': 'string'}, 'since': {'type': 'integer'}}, 'required': ['query']}},
    {'name': 'arra_files_read', 'description': 'Read a bounded excerpt by document ID.',
     'inputSchema': {'type': 'object', 'properties': {'document_id': {'type': 'string'}, 'offset': {'type': 'integer'}, 'limit': {'type': 'integer'}}, 'required': ['document_id']}},
    {'name': 'arra_files_status', 'description': 'Coverage and queue status for the private file corpus.',
     'inputSchema': {'type': 'object', 'properties': {}}},
]


def result(value):
    return {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=True)}]}


def dispatch(request, db):
    method = request.get('method')
    request_id = request.get('id')
    if method == 'initialize':
        value = {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'arra-files', 'version': '1.0.0'}}
    elif method == 'notifications/initialized':
        return None
    elif method == 'tools/list':
        value = {'tools': TOOLS}
    elif method == 'tools/call':
        params = request.get('params') or {}; name = params.get('name'); args = params.get('arguments') or {}
        if name == 'arra_files_search':
            value = (semantic_search(str(db.path), args.get('query', ''), limit=args.get('limit', 5), device=args.get('device'), path=args.get('path'), format=args.get('format'), since=args.get('since'))
                     if args.get('mode') == 'semantic' else db.search(args.get('query', ''), args.get('limit', 5), args.get('device'), args.get('path'), args.get('format'), args.get('since')))
        elif name == 'arra_files_read': value = db.read(args.get('document_id', ''), args.get('offset', 0), args.get('limit', 16000)) or {'error': 'not_found'}
        elif name == 'arra_files_status': value = db.status()
        else: value = {'error': 'unknown_tool'}
        return {'jsonrpc': '2.0', 'id': request_id, 'result': result(value)}
    else:
        return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': -32601, 'message': 'method_not_found'}}
    return {'jsonrpc': '2.0', 'id': request_id, 'result': value}


def serve(db_path):
    db = FileDb(db_path)
    try:
        for line in sys.stdin:
            try:
                response = dispatch(json.loads(line), db)
                if response is not None:
                    sys.stdout.write(json.dumps(response) + '\n'); sys.stdout.flush()
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'invalid_request'}}) + '\n'); sys.stdout.flush()
    finally:
        db.close()


if __name__ == '__main__':
    serve(os.environ.get('ARRA_FILES_DB', '/home/poramateake/.local/state/arra-files/private/files.db'))
