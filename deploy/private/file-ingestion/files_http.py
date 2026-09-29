"""Authenticated local HTTP read surface for the private file corpus."""
import json
import os
from html import escape
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse
from embed import semantic_search
from filedb import FileDb


class Handler(BaseHTTPRequestHandler):
    db = None
    token = ''
    def log_message(self, *_): pass
    def _send(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def _send_html(self, status, body):
        encoded = body.encode()
        self.send_response(status); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(encoded))); self.end_headers(); self.wfile.write(encoded)
    def _auth(self):
        return self.headers.get('Authorization', '') == f'Bearer {self.token}' and bool(self.token)
    def do_GET(self):
        if not self._auth(): return self._send(401, {'error': 'unauthorized'})
        parsed = urlparse(self.path); query = parse_qs(parsed.query)
        if parsed.path in ('/', '/dashboard'):
            status = self.db.status(); q = query.get('q', [''])[0]
            matches = self.db.search(q, 5) if q else []
            counts = ''.join(f'<li>{escape(str(key))}: {value}</li>' for key, value in status['counts'].items())
            rows = ''.join(f'<li><code>{escape(item["device"])}:{escape(item["path"])}</code> — {escape(item.get("preview") or "")}</li>' for item in matches)
            return self._send_html(200, '<!doctype html><meta charset="utf-8"><title>Arra files</title>'
                '<h1>Arra file corpus</h1><h2>Coverage</h2><ul>' + counts + '</ul>'
                '<form><input name="q" value="' + escape(q, quote=True) + '" placeholder="search"><button>Search</button></form>'
                '<ol>' + rows + '</ol><p>Read-only; use MCP/API for bounded excerpts.</p>')
        if parsed.path == '/status': return self._send(200, self.db.status())
        if parsed.path == '/search':
            args = {'query': query.get('q', [''])[0], 'limit': query.get('limit', [5])[0], 'device': query.get('device', [None])[0], 'path': query.get('path', [None])[0], 'format': query.get('format', [None])[0], 'since': query.get('since', [None])[0]}
            if query.get('mode', ['keyword'])[0] == 'semantic':
                return self._send(200, semantic_search(str(self.db.path), **args))
            return self._send(200, self.db.search(**args))
        if parsed.path == '/read': return self._send(200, self.db.read(query.get('id', [''])[0], query.get('offset', [0])[0], query.get('limit', [16000])[0]) or {'error': 'not_found'})
        return self._send(404, {'error': 'not_found'})


def serve(db_path, host=None, port=None, token=None):
    Handler.db = FileDb(db_path); Handler.token = token or os.environ['ARRA_FILES_TOKEN']
    host = host or os.environ.get('ARRA_FILES_HOST', '127.0.0.1')
    port = int(port or os.environ.get('ARRA_FILES_PORT', '47782'))
    try: HTTPServer((host, port), Handler).serve_forever()
    finally: Handler.db.close()


if __name__ == '__main__':
    serve(os.environ.get('ARRA_FILES_DB', '/home/poramateake/.local/state/arra-files/private/files.db'))
