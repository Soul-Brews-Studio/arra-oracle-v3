"""Import committed screened payloads into the separate file database."""
import hashlib
import json
from pathlib import Path

from filedb import FileDb


def import_received(directory, db_path):
    directory, db = Path(directory), FileDb(db_path)
    imported = rejected = 0
    try:
        for payload in sorted(directory.glob('*.received')):
            marker = payload.with_suffix('.processed')
            if marker.exists() or payload.with_suffix('.rejected').exists(): continue
            try:
                raw = payload.read_bytes()
                if hashlib.sha256(raw).hexdigest() != payload.stem:
                    raise ValueError('checksum')
                value = json.loads(raw)
                record, content = value['record'], value.get('content', '')
                if record.get('device') not in {'mac', 'mint', 'acer'} or not isinstance(content, str):
                    raise ValueError('invalid_payload')
                db.upsert(record, content, {'device': record['device'], 'volume': record.get('volume'), 'path': record['path']})
                marker.write_text('imported\n')
                imported += 1
            except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
                payload.with_suffix('.rejected').write_text('rejected\n')
                rejected += 1
        return {'imported': imported, 'rejected': rejected}
    finally:
        db.close()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True); parser.add_argument('--db', required=True)
    args = parser.parse_args(); print(import_received(args.directory, args.db))
