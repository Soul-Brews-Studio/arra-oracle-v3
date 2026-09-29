"""Bounded local extraction. Input is untrusted; output is never executable."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import zipfile

MAX_TEXT = 32 * 1024 * 1024
MAX_MEDIA = 4 * 1024**3
MAX_MEMBER = 64 * 1024 * 1024
ARCHIVE_MEMBERS = 10_000
ARCHIVE_BYTES = 1024**3
ARCHIVE_DEPTH = 3
SECRET = re.compile(
    r'(?i)(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|'
    r'(?:(?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*["\']?)[A-Za-z0-9_./+=-]{12,})')
TEXT_EXTS = {'.txt', '.md', '.mdx', '.json', '.xml', '.csv', '.tsv', '.log',
             '.py', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.htm',
             '.rtf', '.epub', '.yaml', '.yml', '.toml', '.ini', '.conf'}
OFFICE_EXTS = {'.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'}
AUDIO_EXTS = {'.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.wma'}
VIDEO_EXTS = {'.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm', '.wmv'}


def _safe_text(raw):
    text = raw.decode('utf-8', 'replace')
    if SECRET.search(text):
        return None, 'secret_detected'
    return text[:MAX_TEXT], None


def _run(command, timeout=120):
    try:
        return subprocess.run(command, check=True, capture_output=True, timeout=timeout,
                              stdin=subprocess.DEVNULL).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def _digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _media(path, temporary, video=False):
    parts = []
    whisper = os.environ.get('ARRA_WHISPER_BIN')
    if whisper and temporary:
        output = Path(temporary) / 'whisper'; output.mkdir(mode=0o700, exist_ok=True)
        command = [whisper, str(path), '--model', os.environ.get('ARRA_WHISPER_MODEL', 'small'),
                   '--output_format', 'json', '--output_dir', str(output), '--device', 'cpu',
                   '--fp16', 'False', '--verbose', 'False']
        raw = _run(command, timeout=1800)
        transcript = output / (path.stem + '.json')
        if raw is not None and transcript.exists():
            try:
                for segment in json.loads(transcript.read_text()).get('segments', []):
                    text, reason = _safe_text(str(segment.get('text', '')).strip().encode())
                    if reason:
                        return [], 'secret_detected'
                    if text:
                        parts.append({'text': text, 'start': segment.get('start'),
                                      'end': segment.get('end'), 'provenance': 'whisper'})
            except (OSError, ValueError, TypeError):
                return [], 'malformed_transcript'
    reason = None if parts else 'whisper_unavailable'
    if video and temporary:
        frames = Path(temporary) / 'video-frames'; frames.mkdir(mode=0o700, exist_ok=True)
        if _run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path),
                 '-vf', 'fps=1/30,scale=1280:-1', '-frames:v', '100', str(frames / 'frame-%03d.png')], 300) is not None:
            for index, image in enumerate(sorted(frames.glob('frame-*.png')), 1):
                text, frame_reason = _safe_text((_run(['tesseract', str(image), 'stdout', '-l', 'eng+tha'], 60) or b''))
                if frame_reason:
                    return [], frame_reason
                if text:
                    parts.append({'text': text, 'timestamp_s': (index - 1) * 30, 'provenance': 'video_frame_ocr'})
            if parts and reason == 'whisper_unavailable':
                reason = None
    return parts, reason


def _archive_entries(path, depth, seen, output):
    if depth > ARCHIVE_DEPTH:
        return 'partial_depth'
    count = output['members']
    if path.suffix.lower() == '.zip':
        try:
            archive = zipfile.ZipFile(path)
            entries = archive.infolist()
            for member in entries:
                if count >= ARCHIVE_MEMBERS:
                    return 'partial_members'
                name = member.filename.replace('\\', '/')
                if name.startswith('/') or '..' in Path(name).parts or member.is_dir():
                    return 'blocked_archive_entry'
                if member.file_size > MAX_MEMBER or output['bytes'] + member.file_size > ARCHIVE_BYTES:
                    return 'partial_size'
                output['members'] += 1
                output['bytes'] += member.file_size
                if member.file_size and Path(name).suffix.lower() in TEXT_EXTS:
                    raw = archive.read(member)
                    text, reason = _safe_text(raw[:MAX_TEXT])
                    if reason:
                        return reason
                    output['parts'].append({'member': name, 'text': text})
                count += 1
            return None
        except (OSError, zipfile.BadZipFile, RuntimeError):
            return 'malformed_archive'
    try:
        with tarfile.open(path, 'r:*') as archive:
            for member in archive:
                if output['members'] >= ARCHIVE_MEMBERS:
                    return 'partial_members'
                if member.name.startswith('/') or '..' in Path(member.name).parts or not member.isfile():
                    return 'blocked_archive_entry'
                if member.size > MAX_MEMBER or output['bytes'] + member.size > ARCHIVE_BYTES:
                    return 'partial_size'
                output['members'] += 1
                output['bytes'] += member.size
                if member.size and Path(member.name).suffix.lower() in TEXT_EXTS:
                    body = archive.extractfile(member)
                    raw = body.read(MAX_TEXT) if body else b''
                    text, reason = _safe_text(raw)
                    if reason:
                        return reason
                    output['parts'].append({'member': member.name, 'text': text})
            return None
    except (OSError, tarfile.TarError):
        return 'malformed_archive'


def extract(path, temporary=None):
    path = Path(path)
    result = {'path': str(path), 'sha256': None, 'format': 'metadata', 'parts': []}
    try:
        if path.is_symlink():
            result['status'] = 'metadata_only'
            result['reason'] = 'symlink'
            return result
        info = path.stat()
        result.update(size=info.st_size, mtime_ns=info.st_mtime_ns)
        ext = path.suffix.lower()
        max_size = MAX_MEDIA if ext in AUDIO_EXTS | VIDEO_EXTS or ext in {'.zip', '.tar', '.tgz', '.7z', '.rar', '.gz'} else MAX_TEXT
        if not path.is_file() or info.st_size > max_size:
            result['status'] = 'metadata_only'
            result['reason'] = 'unsupported_or_oversize'
            return result
        result['sha256'] = _digest(path)
        if ext in TEXT_EXTS:
            text, reason = _safe_text(path.read_bytes())
            result.update(format='text', status='quarantined' if reason else 'extracted')
            result['reason'] = reason
            if text is not None:
                result['parts'] = [{'text': text}]
            return result
        if ext == '.pdf':
            raw = _run(['pdftotext', '-enc', 'UTF-8', str(path), '-'])
            text, reason = _safe_text(raw or b'') if raw is not None else (None, 'tool_unavailable')
            if raw is not None and not text and temporary:
                text = None
                pages = Path(temporary) / 'pdf-pages'; pages.mkdir(mode=0o700, exist_ok=True)
                converted = _run(['pdftoppm', '-png', '-r', '150', str(path), str(pages / 'page')])
                if converted is None:
                    reason = 'ocr_tool_unavailable'
                for index, image in enumerate(sorted(pages.glob('page-*.png'))[:100], 1):
                    ocr = _run(['tesseract', str(image), 'stdout', '-l', 'eng+tha'])
                    page_text, page_reason = _safe_text(ocr or b'') if ocr is not None else (None, 'tool_unavailable')
                    if page_reason:
                        reason = page_reason; text = None; break
                    if page_text:
                        result['parts'].append({'page': index, 'text': page_text, 'provenance': 'ocr'})
                if result['parts'] and text is None and reason != 'secret_detected':
                    result.update(format='pdf_ocr', status='extracted', reason='image_only_pdf')
                    return result
            status = 'quarantined' if reason == 'secret_detected' else ('extracted' if text else 'blocked')
            result.update(format='pdf', status=status, reason=reason or ('no_text' if status == 'blocked' else None))
            if text is not None:
                result['parts'] = [{'page': None, 'text': text}]
            return result
        if ext in OFFICE_EXTS:
            if not temporary:
                result.update(status='blocked', reason='conversion_workspace_required')
                return result
            workspace = Path(temporary)
            workspace.mkdir(mode=0o700, parents=True, exist_ok=True)
            converted = _run(['soffice', '--headless', '--norestore', '--nodefault', '--nolockcheck',
                              '--convert-to', 'txt:Text', '--outdir', str(workspace), str(path)])
            target = workspace / (path.stem + '.txt')
            raw = target.read_bytes() if converted is not None and target.exists() else None
            text, reason = _safe_text(raw or b'') if raw is not None else (None, 'tool_unavailable')
            result.update(format='office', status='quarantined' if reason == 'secret_detected' else ('extracted' if raw is not None else 'blocked'), reason=reason)
            if text is not None:
                result['parts'] = [{'text': text}]
            return result
        if ext in AUDIO_EXTS | VIDEO_EXTS:
            parts, reason = _media(path, temporary, ext in VIDEO_EXTS)
            status = 'quarantined' if reason == 'secret_detected' else ('extracted' if parts else 'blocked')
            result.update(format='video' if ext in VIDEO_EXTS else 'audio', status=status, reason=reason)
            result['parts'] = parts
            return result
        if ext == '.gz':
            with gzip.open(path, 'rb') as compressed:
                raw = compressed.read(MAX_MEMBER + 1)
            text, reason = _safe_text(raw[:MAX_TEXT])
            result.update(format='gzip', status='quarantined' if reason == 'secret_detected' else 'extracted', reason=reason)
            if text is not None:
                result['parts'] = [{'member': path.stem, 'text': text}]
            return result
        if ext in {'.zip', '.tar', '.tgz', '.7z', '.rar'}:
            archive = {'members': 0, 'bytes': 0, 'parts': []}
            reason = _archive_entries(path, 1, set(), archive) if ext in {'.zip', '.tar', '.gz', '.tgz'} else 'tool_unavailable'
            result.update(format='archive', status='extracted' if reason is None else 'partial' if reason.startswith('partial') else 'blocked', reason=reason, members=archive['members'], expanded_bytes=archive['bytes'], parts=archive['parts'])
            return result
        if ext in {'.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp'}:
            binary = _run(['tesseract', str(path), 'stdout', '-l', 'eng+tha'])
            text, reason = _safe_text(binary or b'') if binary is not None else (None, 'tool_unavailable')
            result.update(format='image_ocr', status='quarantined' if reason == 'secret_detected' else ('extracted' if binary is not None else 'blocked'), reason=reason)
            if text is not None:
                result['parts'] = [{'text': text, 'provenance': 'image'}]
            return result
        result.update(status='metadata_only', reason='unsupported_format')
        return result
    except (OSError, UnicodeError) as error:
        result.update(status='blocked', reason=type(error).__name__)
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--temporary')
    args = parser.parse_args()
    print(extract(args.path, args.temporary))
