"""Private metadata snapshots. No body reads or transfers; stdout is aggregate-only."""
import argparse
from collections import Counter
import json
import gzip
import os
from pathlib import Path
import shutil
import time
import uuid

from inventory import scan


def save_json(path, value):
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def capture(root, device, volume, state, exclusions=(), floor=15 * 1024**3,
            limit=None):
    state = Path(state).absolute()
    if state.is_symlink():
        raise ValueError('state must not be a symlink')
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != 'nt' and state.stat().st_mode & 0o077:
        raise ValueError('state permissions must be 0700')
    lock = state / 'lock'
    lock.mkdir(mode=0o700)
    run = uuid.uuid4().hex
    counts = Counter()
    result = {'scan_id': run, 'device': device, 'volume': volume,
              'started': time.time(), 'complete': False, 'source_bytes': 0}
    try:
        used = sum(p.stat().st_size for p in state.iterdir() if p.is_file())
        fd = os.open(state / (run + '.jsonl.gz'),
                     os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=1) as stream:
            for record in scan(root, device, volume, [*exclusions, state]):
                encoded = (json.dumps(record, ensure_ascii=True) + '\n').encode()
                if ((limit is not None and used + len(encoded) > limit)
                        or shutil.disk_usage(state).free < floor + len(encoded) + 65536):
                    result['reason'] = 'capacity'
                    break
                stream.write(encoded)
                used += len(encoded)
                if 'status' in record:
                    counts[record['status']] += 1
                    result['source_bytes'] += record.get('size', 0)
                else:
                    result['complete'] = record['complete']
                if sum(counts.values()) % 1000 == 0:
                    stream.flush()
                    raw.flush()
                    os.fsync(raw.fileno())
            stream.flush()
            raw.flush()
            os.fsync(raw.fileno())
        result.update(counts=dict(counts), ended=time.time())
        save_json(state / (run + '.summary.json'), result)
        if result['complete']:
            save_json(state / 'latest.json', result)
        return result
    finally:
        lock.rmdir()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--device', required=True, choices=['mac', 'mint', 'acer'])
    parser.add_argument('--volume', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--exclude', action='append', default=[])
    args = parser.parse_args()
    floor = {'mac': 10, 'mint': 15, 'acer': 20}[args.device] * 1024**3
    print(json.dumps(capture(args.root, args.device, args.volume, args.state,
                             args.exclude, floor)))
