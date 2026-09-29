"""Strict SSH transport for screened extracted payloads."""
import base64
import hashlib
import os
import json
from pathlib import Path
import subprocess
import tempfile
import time

# Keep framed lines below Windows OpenSSH's pipe threshold.
CHUNK = 32 * 1024
BATCH = 48 * 1024
TIMEOUT = 60


def frames(payload, device):
    raw = json.dumps(payload, ensure_ascii=True, separators=(',', ':')).encode()
    digest = hashlib.sha256(raw).hexdigest()
    yield {'op': 'begin', 'device': device, 'object': digest, 'size': len(raw)}
    for offset in range(0, len(raw), CHUNK):
        chunk = raw[offset:offset + CHUNK]
        yield {'op': 'chunk', 'device': device, 'object': digest, 'offset': offset,
               'data': base64.b64encode(chunk).decode(),
               'checksum': hashlib.sha256(chunk).hexdigest()}
    yield {'op': 'commit', 'device': device, 'object': digest}


def _batches(lines):
    batch, size = [], 0
    for line in lines:
        length = len(line.encode())
        if length > BATCH:
            raise ValueError('transport frame too large')
        if batch and size + length > BATCH:
            yield batch
            batch, size = [], 0
        batch.append(line); size += length
    if batch:
        yield batch


def _run(command, lines):
    body = ''.join(lines)
    fd, path = tempfile.mkstemp(prefix='arra-files-', suffix='.jsonl')
    out_fd, out_path = tempfile.mkstemp(prefix='arra-files-out-', suffix='.jsonl')
    err_fd, err_path = tempfile.mkstemp(prefix='arra-files-err-', suffix='.log')
    os.close(out_fd); os.close(err_fd)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as stream:
            os.chmod(path, 0o600)
            stream.write(body)
        with open(path, 'r', encoding='utf-8', newline='') as stream:
            with open(out_path, 'w', encoding='utf-8') as output, open(err_path, 'w', encoding='utf-8') as errors:
                process = subprocess.Popen(command, stdin=stream, stdout=output, stderr=errors)
        deadline = time.monotonic() + TIMEOUT
        responses = []
        complete = False
        while time.monotonic() < deadline:
            output = Path(out_path).read_text(encoding='utf-8', errors='replace')
            try:
                responses = [json.loads(line) for line in output.splitlines() if line.strip()]
            except json.JSONDecodeError:
                responses = []
            if responses and responses[-1].get('status') == 'rejected':
                break
            if len(responses) >= len(lines):
                complete = True
                break
            if process.poll() is not None:
                break
            time.sleep(0.05)
        if len(responses) < len(lines) and process.poll() is None:
            process.kill(); process.wait()
            error = Path(err_path).read_text(encoding='utf-8', errors='replace')
            raise RuntimeError(f'transport timeout: {error[-500:]}')
        if process.poll() is None:
            process.kill(); process.wait()
        error = Path(err_path).read_text(encoding='utf-8', errors='replace')
        return (0 if complete else process.returncode), responses, error
    finally:
        for temporary in (path, out_path, err_path):
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def send(payload, device, key, target, known_hosts):
    command = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'UpdateHostKeys=no', '-o', 'IdentitiesOnly=yes', '-o',
               f'UserKnownHostsFile={known_hosts}', '-o', 'ConnectTimeout=15', '-i', key, target]
    lines = [json.dumps(frame, ensure_ascii=True, separators=(',', ':')) + '\n'
             for frame in frames(payload, device)]
    responses = []
    for batch in _batches(lines):
        returncode, result, error = _run(command, batch)
        if returncode:
            raise RuntimeError(f'transport failed: {error[-500:]}')
        responses.extend(result)
        if result and result[-1].get('status') == 'rejected':
            raise RuntimeError('receiver rejected payload')
    if not responses or responses[-1].get('status') != 'received':
        raise RuntimeError('receiver did not commit payload')
    return responses[-1]
