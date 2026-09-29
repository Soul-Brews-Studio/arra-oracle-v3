"""Bounded object receiver core; not enabled for real content until screening gates pass."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

LIMIT = 512 * 1024**2
CHUNK = 1024**2


def accept(root, device, frame, floor=15 * 1024**3):
    if device not in {'mac', 'mint', 'acer'} or frame.get('device') != device:
        raise ValueError('invalid device')
    identity = frame.get('object', '')
    if not isinstance(identity, str) or not re.fullmatch('[a-f0-9]{64}', identity):
        raise ValueError('invalid object')
    directory = Path(root) / device
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise ValueError('unsafe receiver directory')
    # Mint-only receiver: native advisory lock serializes validation and mutation.
    import fcntl
    fd = os.open(directory / 'receiver.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return apply_frame(directory, identity, frame, floor)


def apply_frame(directory, identity, frame, floor):
    part = directory / (identity + '.part')
    meta = directory / (identity + '.json')
    done = directory / (identity + '.received')
    if any(path.is_symlink() for path in (part, meta, done)):
        raise ValueError('unsafe object')
    operation = frame.get('op')
    if operation not in {'begin', 'chunk', 'commit'}:
        raise ValueError('invalid operation')
    if operation == 'begin':
        size = frame.get('size')
        if type(size) is not int or not 0 <= size <= LIMIT:
            raise ValueError('invalid size')
        if meta.exists():
            if json.loads(meta.read_text())['size'] != size:
                raise ValueError('object size conflict')
        else:
            reserved = sum(json.loads(p.read_text())['size'] for p in directory.glob('*.json'))
            if reserved + size > LIMIT or shutil.disk_usage(directory).free < floor + size + 4096:
                raise ValueError('capacity')
            fd = os.open(meta, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump({'size': size}, stream)
                stream.flush()
                os.fsync(stream.fileno())
        if not part.exists() and not done.exists():
            os.close(os.open(part, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
        return {'offset': (done if done.exists() else part).stat().st_size}
    if not meta.exists():
        raise ValueError('begin required')
    size = json.loads(meta.read_text())['size']
    target = done if done.exists() else part
    if operation == 'chunk':
        encoded = frame.get('data')
        offset = frame.get('offset')
        if not isinstance(encoded, str) or len(encoded) > 4 * ((CHUNK + 2) // 3):
            raise ValueError('invalid chunk')
        payload = base64.b64decode(encoded, validate=True)
        if not payload or len(payload) > CHUNK or type(offset) is not int or offset < 0:
            raise ValueError('invalid chunk')
        if hashlib.sha256(payload).hexdigest() != frame.get('checksum'):
            raise ValueError('chunk checksum')
        current = target.stat().st_size
        if offset + len(payload) > size or offset > current:
            raise ValueError('invalid sequence')
        with target.open('r+b') as stream:
            stream.seek(offset)
            if offset < current:
                if stream.read(len(payload)) != payload:
                    raise ValueError('retry conflict')
            else:
                if done.exists() or shutil.disk_usage(directory).free < floor + len(payload):
                    raise ValueError('capacity or immutable object')
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        return {'offset': target.stat().st_size}
    if target.stat().st_size != size:
        raise ValueError('incomplete object')
    with target.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != identity:
            raise ValueError('object checksum')
    if target == part:
        os.replace(part, done)
    return {'status': 'received', 'object': identity}


def serve(root, device, source, destination, original_command):
    if original_command:
        raise ValueError('remote commands prohibited')
    while True:
        line = source.readline(2 * 1024**2 + 1)
        if not line:
            return
        try:
            if len(line) > 2 * 1024**2:
                raise ValueError('frame too large')
            frame = json.loads(line)
            if not isinstance(frame, dict):
                raise ValueError('invalid frame')
            result = accept(root, device, frame)
        except (ValueError, KeyError, TypeError, OSError):
            destination.write('{"status":"rejected"}\n')
            destination.flush()
            return
        destination.write(json.dumps(result) + '\n')
        destination.flush()
        if result.get('status') == 'received':
            return


if __name__ == '__main__':
    import argparse
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--device', choices=['mac', 'mint', 'acer'], required=True)
    args = parser.parse_args()
    if os.environ.get('SSH_ORIGINAL_COMMAND'):
        sys.exit(2)
    serve(Path(args.root), args.device, sys.stdin.buffer, sys.stdout, '')
