"""Separate read-only file corpus store using SQLite FTS5."""
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import time


def doc_id(device, volume, source_id):
    return hashlib.sha256(f'{device}\0{volume}\0{source_id}'.encode()).hexdigest()[:32]


class FileDb:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        os.chmod(self.path, 0o600)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY, device TEXT NOT NULL, volume TEXT NOT NULL,
            path TEXT NOT NULL, size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL,
            format TEXT NOT NULL, status TEXT NOT NULL, reason TEXT,
            sha256 TEXT, content TEXT, provenance TEXT NOT NULL DEFAULT '{}',
            indexed_at INTEGER NOT NULL
          );
          CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
            id UNINDEXED, path, content, tokenize='unicode61'
          );
          CREATE TABLE IF NOT EXISTS file_vectors (
            id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
            vector TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS scan_runs (
            scan_id TEXT PRIMARY KEY, device TEXT NOT NULL, volume TEXT NOT NULL,
            complete INTEGER NOT NULL, counts TEXT NOT NULL, started REAL, ended REAL
          );
        ''')
        self.db.commit()
        for sidecar in (self.path.with_name(self.path.name + '-wal'), self.path.with_name(self.path.name + '-shm')):
            if sidecar.exists(): os.chmod(sidecar, 0o600)

    def close(self):
        self.db.close()

    def upsert(self, record, content='', provenance=None):
        source = record.get('source_id') or record.get('sha256') or record['path']
        identifier = doc_id(record['device'], record['volume'], source)
        values = (identifier, record['device'], record['volume'], record['path'],
                  int(record.get('size', 0)), int(record.get('mtime_ns', 0)),
                  record.get('format', 'metadata'), record.get('status', 'metadata_only'),
                  record.get('reason'), record.get('sha256'), content,
                  json.dumps(provenance or {}, separators=(',', ':')), int(time.time() * 1000))
        previous = self.db.execute('SELECT sha256,content FROM files WHERE id=?', (identifier,)).fetchone()
        if previous and (previous[0] != record.get('sha256') or previous[1] != content):
            self.db.execute('DELETE FROM file_vectors WHERE id=?', (identifier,))
        self.db.execute('''INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET size=excluded.size,mtime_ns=excluded.mtime_ns,
          format=excluded.format,status=excluded.status,reason=excluded.reason,
          sha256=excluded.sha256,content=excluded.content,provenance=excluded.provenance,
          indexed_at=excluded.indexed_at''', values)
        self.db.execute('DELETE FROM file_fts WHERE id=?', (identifier,))
        self.db.execute('INSERT INTO file_fts(id,path,content) VALUES (?,?,?)',
                        (identifier, record['path'], content[:32 * 1024 * 1024]))
        self.db.commit()
        return identifier

    def record_scan(self, scan_id, device, volume, complete, counts, started=None, ended=None):
        self.db.execute('INSERT OR REPLACE INTO scan_runs VALUES (?,?,?,?,?,?,?)',
                        (scan_id, device, volume, int(complete), json.dumps(counts), started, ended))
        self.db.commit()

    def reconcile(self, device, volume, source_ids):
        keep = {doc_id(device, volume, source) for source in source_ids}
        rows = self.db.execute('SELECT id FROM files WHERE device=? AND volume=?', (device, volume)).fetchall()
        stale = [identifier for (identifier,) in rows if identifier not in keep]
        for identifier in stale:
            self.db.execute('DELETE FROM file_vectors WHERE id=?', (identifier,))
            self.db.execute('DELETE FROM file_fts WHERE id=?', (identifier,))
            self.db.execute('DELETE FROM files WHERE id=?', (identifier,))
        self.db.commit()
        return len(stale)

    def search(self, query, limit=5, device=None, path=None, format=None, since=None):
        limit = max(1, min(int(limit), 20))
        terms = ' '.join('"' + part.replace('"', '""') + '"' for part in query.split() if part)
        if not terms:
            return []
        clauses, params = ['file_fts MATCH ?'], [terms]
        if device: clauses.append('f.device=?'); params.append(device)
        if path: clauses.append('f.path LIKE ?'); params.append(path.rstrip('/') + '%')
        if format: clauses.append('f.format=?'); params.append(format)
        if since: clauses.append('f.mtime_ns>=?'); params.append(int(since))
        params.append(limit)
        rows = self.db.execute('''SELECT f.id,f.device,f.volume,f.path,f.size,f.mtime_ns,
          f.format,f.status,f.reason,substr(f.content,1,500),f.provenance
          FROM file_fts JOIN files f ON f.id=file_fts.id WHERE ''' + ' AND '.join(clauses) +
          ' ORDER BY rank LIMIT ?', params).fetchall()
        return [self._row(row) for row in rows]

    def read(self, identifier, offset=0, limit=16000):
        limit = max(1, min(int(limit), 16000)); offset = max(0, int(offset))
        row = self.db.execute('SELECT id,device,volume,path,status,format,provenance,content FROM files WHERE id=?', (identifier,)).fetchone()
        if not row: return None
        item = dict(zip(('id','device','volume','path','status','format','provenance','content'), row))
        item['provenance'] = json.loads(item['provenance'])
        content = item.pop('content') or ''
        item.update(excerpt=content[offset:offset + limit], offset=offset,
                    next_offset=offset + limit if offset + limit < len(content) else None)
        return item

    def status(self):
        rows = self.db.execute('SELECT status,COUNT(*) FROM files GROUP BY status').fetchall()
        scans = self.db.execute('SELECT device,volume,complete,ended,counts FROM scan_runs ORDER BY ended DESC').fetchall()
        return {'counts': dict(rows), 'scans': [{'device': d, 'volume': v, 'complete': bool(c), 'ended': e, 'counts': json.loads(n)} for d,v,c,e,n in scans]}

    @staticmethod
    def _row(row):
        keys = ('id','device','volume','path','size','mtime_ns','format','status','reason','preview','provenance')
        result = dict(zip(keys, row)); result['provenance'] = json.loads(result['provenance']); return result


def cosine(left, right):
    if len(left) != len(right) or not left: return 0.0
    dot = sum(a * b for a, b in zip(left, right)); norm = math.sqrt(sum(a * a for a in left) * sum(b * b for b in right))
    return dot / norm if norm else 0.0
