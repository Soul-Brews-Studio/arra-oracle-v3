"""Loopback-only Ollama bge-m3 embedding worker."""
import argparse
import json
import math
import sqlite3
import urllib.request


def embed(texts, url='http://127.0.0.1:11434/api/embed', model='bge-m3'):
    request = urllib.request.Request(url, json.dumps({'model': model, 'input': texts}).encode(),
                                     {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        value = json.load(response)
    vectors = value.get('embeddings')
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        raise ValueError('embedding response shape')
    if any(not isinstance(vector, list) or len(vector) != 1024 for vector in vectors):
        raise ValueError('embedding dimension')
    return vectors


def embed_pending(db_path, url='http://127.0.0.1:11434/api/embed', model='bge-m3', limit=4):
    db = sqlite3.connect(db_path)
    rows = db.execute('SELECT id,content FROM files WHERE content<>"" AND id NOT IN (SELECT id FROM file_vectors) LIMIT ?', (limit,)).fetchall()
    if not rows: db.close(); return {'embedded': 0, 'dimensions': 1024}
    vectors = embed([content for _, content in rows], url, model)
    db.executemany('INSERT OR REPLACE INTO file_vectors VALUES (?,?,?,?)', [(identifier, json.dumps(vector), model, len(vector)) for (identifier, _), vector in zip(rows, vectors)])
    db.commit(); db.close()
    return {'embedded': len(rows), 'dimensions': len(vectors[0])}


def semantic_search(db_path, query, url='http://127.0.0.1:11434/api/embed', model='bge-m3', limit=5, device=None, path=None, format=None, since=None):
    query_vector = embed([query], url, model)[0]
    db = sqlite3.connect(db_path)
    clauses, params = [], []
    if device: clauses.append('f.device=?'); params.append(device)
    if path: clauses.append('f.path LIKE ?'); params.append(path.rstrip('/') + '%')
    if format: clauses.append('f.format=?'); params.append(format)
    if since: clauses.append('f.mtime_ns>=?'); params.append(int(since))
    where = (' WHERE ' + ' AND '.join(clauses)) if clauses else ''
    rows = db.execute('SELECT f.id,f.device,f.volume,f.path,f.size,f.mtime_ns,f.format,f.status,f.reason,substr(f.content,1,500),f.provenance,v.vector FROM files f JOIN file_vectors v ON f.id=v.id' + where, params).fetchall()
    db.close()
    def score(row):
        vector = json.loads(row[-1]); dot = sum(a * b for a, b in zip(query_vector, vector)); denom = math.sqrt(sum(a * a for a in query_vector) * sum(a * a for a in vector))
        return dot / denom if denom else 0
    rows = sorted(rows, key=score, reverse=True)[:max(1, min(int(limit), 20))]
    result = []
    for row in rows:
        value = dict(zip(('id','device','volume','path','size','mtime_ns','format','status','reason','preview','provenance','_vector'), row)); value.pop('_vector'); value['provenance'] = json.loads(value['provenance']); value['score'] = score(row); result.append(value)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--db', required=True); parser.add_argument('--url', default='http://127.0.0.1:11434/api/embed'); parser.add_argument('--limit', type=int, default=4)
    args = parser.parse_args(); print(embed_pending(args.db, args.url, limit=args.limit))
