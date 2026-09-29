"""Resumable local extraction-to-private-index pipeline."""
import argparse
import gzip
import json
import os
from pathlib import Path
import tempfile
import time

from extract import extract
from filedb import FileDb


def run(snapshot, root, db_path, state, max_items=None):
    snapshot, root, state = Path(snapshot), Path(root), Path(state)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    checkpoint = state / 'checkpoint.json'
    saved = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    start = saved.get('line', 0) if saved.get('snapshot') == snapshot.name else 0
    indexed = failed = 0; seen = set(); scan_complete = False
    scan_device = scan_volume = None
    reconcile_allowed = max_items is None and start == 0
    db = FileDb(db_path)
    try:
        opener = gzip.open if snapshot.suffix == '.gz' else open
        with opener(snapshot, 'rt', encoding='utf-8') as stream:
            for line_number, line in enumerate(stream):
                if line_number < start: continue
                record = json.loads(line)
                if 'status' not in record or record.get('status') != 'discovered':
                    scan_complete = bool(record.get('complete', False)) or scan_complete
                    start = line_number + 1
                    continue
                scan_device = scan_device or record.get('device')
                scan_volume = scan_volume or record.get('volume')
                if record.get('source_id'):
                    seen.add(record['source_id'])
                source = root / record['path']
                try:
                    before = source.stat()
                    with tempfile.TemporaryDirectory(prefix='arra-extract-', dir=state) as temporary:
                        result = extract(source, temporary)
                    after = source.stat()
                    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                        result.update(status='partial', reason='changed_during_read', parts=[])
                    text = '\n\n'.join(part.get('text', '') for part in result.get('parts', []))
                    indexed_record = {**record, **result, 'path': record['path']}
                    identifier = db.upsert(indexed_record, text,
                                           {'source': record['path'], 'device': record['device'], 'volume': record['volume']})
                    indexed += 1
                except OSError as error:
                    db.upsert({**record, 'status': 'blocked', 'reason': type(error).__name__}, '')
                    failed += 1
                start = line_number + 1
                if start % 100 == 0:
                    _checkpoint(checkpoint, snapshot.name, start, indexed, failed)
                if max_items is not None and indexed + failed >= max_items: break
        removed = db.reconcile(scan_device, scan_volume, seen) if reconcile_allowed and scan_complete else 0
        _checkpoint(checkpoint, snapshot.name, start, indexed, failed, done=True)
        return {'processed': indexed, 'failed': failed, 'removed': removed,
                'line': start, 'complete': max_items is None}
    finally:
        db.close()


def _checkpoint(path, snapshot, line, indexed, failed, done=False):
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump({'snapshot': snapshot, 'line': line, 'indexed': indexed, 'failed': failed, 'done': done, 'updated': time.time()}, stream)
        stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary, path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True); parser.add_argument('--root', required=True)
    parser.add_argument('--db', required=True); parser.add_argument('--state', required=True)
    parser.add_argument('--max-items', type=int)
    args = parser.parse_args()
    print(json.dumps(run(args.snapshot, args.root, args.db, args.state, args.max_items)))
