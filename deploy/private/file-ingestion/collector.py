"""Hourly user-scoped collector: inventory, extract, optionally transport."""
import argparse
import json
from pathlib import Path
import sys
import tempfile

from extract import extract
from snapshot import capture
from transport import send
from filedb import FileDb


def collect(root, device, volume, state, db_root=None, limit=None, transport=None):
    state = Path(state)
    extra = [Path(root) / 'Documents/arra-oracle/deployment/private-bundle-20260928'] if device == 'mint' else []
    result = capture(root, device, volume, state / 'inventory', exclusions=[state, db_root, *extra] if db_root else [state, *extra], floor={
        'mac': 10, 'mint': 15, 'acer': 20}[device] * 1024**3)
    snapshots = list((state / 'inventory').glob('*.jsonl.gz'))
    snapshot = max(snapshots, key=lambda path: path.stat().st_mtime_ns) if snapshots else None
    if db_root:
        db = FileDb(db_root)
        try:
            db.record_scan(result.get('scan_id'), device, volume, result.get('complete', False), result.get('counts', {}), result.get('started'), result.get('ended'))
        finally:
            db.close()
    if not snapshot or not transport:
        return result
    sent = 0
    checkpoint = state / 'transport-checkpoint.json'
    saved = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    start = saved.get('line', 0) if saved.get('snapshot') == snapshot.name else 0
    import gzip
    with gzip.open(snapshot, 'rt', encoding='utf-8') as stream:
        for line_number, line in enumerate(stream):
            if line_number < start: continue
            record = json.loads(line)
            if record.get('status') != 'discovered': continue
            source = Path(root) / record['path']
            with tempfile.TemporaryDirectory(prefix='arra-extract-', dir=state) as temp:
                extracted = extract(source, temp)
            content = '\n\n'.join(part.get('text', '') for part in extracted.get('parts', []))
            if transport and extracted.get('status') == 'extracted':
                transport({'record': {**record, **extracted}, 'content': content}, device)
                sent += 1
            if limit is not None and sent >= limit: break
            checkpoint.write_text(json.dumps({'snapshot': snapshot.name, 'line': line_number + 1, 'sent': sent}))
            checkpoint.chmod(0o600)
    return {**result, 'sent': sent}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True); parser.add_argument('--device', required=True, choices=['mac', 'mint', 'acer'])
    parser.add_argument('--volume', required=True); parser.add_argument('--state', required=True)
    parser.add_argument('--db-root')
    parser.add_argument('--transport-key'); parser.add_argument('--transport-target'); parser.add_argument('--known-hosts')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    callback = None
    if args.transport_key or args.transport_target or args.known_hosts:
        if not (args.transport_key and args.transport_target and args.known_hosts):
            parser.error('transport-key, transport-target and known-hosts are required together')
        callback = lambda payload, device: send(payload, device, args.transport_key, args.transport_target, args.known_hosts)
    print(json.dumps(collect(args.root, args.device, args.volume, args.state, db_root=args.db_root, limit=args.limit, transport=callback)))
