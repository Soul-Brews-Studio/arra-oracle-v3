import importlib.util
import gzip
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion/extract.py'
spec = importlib.util.spec_from_file_location('extractor', MODULE)
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class ExtractTest(unittest.TestCase):
    def test_text_and_secret_are_distinct_outcomes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            safe = root / 'safe.txt'
            safe.write_text('hello ไทย')
            secret = root / 'secret.txt'
            secret.write_text('TOKEN=abcdefghijklmnopqrstuvwxyz')
            self.assertEqual(extractor.extract(safe)['status'], 'extracted')
            self.assertEqual(extractor.extract(secret)['reason'], 'secret_detected')
            self.assertEqual(extractor.extract(secret)['parts'], [])

    def test_archive_traversal_is_blocked_without_extracting(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as output:
                output.writestr('../escape.txt', 'must not escape')
            result = extractor.extract(archive)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['reason'], 'blocked_archive_entry')
            self.assertFalse((root.parent / 'escape.txt').exists())

    def test_gzip_text_is_bounded_and_extracted(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / 'note.gz'
            with gzip.open(archive, 'wb') as output:
                output.write('compressed ไทย'.encode())
            result = extractor.extract(archive)
            self.assertEqual(result['status'], 'extracted')
            self.assertEqual(result['parts'][0]['text'], 'compressed ไทย')

    def test_unsupported_and_symlink_are_metadata_only(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            binary = root / 'program.bin'
            binary.write_bytes(b'\x00\x01')
            link = root / 'link.txt'
            link.symlink_to(binary)
            self.assertEqual(extractor.extract(binary)['reason'], 'unsupported_format')
            self.assertEqual(extractor.extract(link)['reason'], 'symlink')

    def test_media_without_pinned_whisper_is_explicitly_blocked(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'recording.wav'; audio.write_bytes(b'not audio')
            result = extractor.extract(audio, folder)
            self.assertEqual(result['format'], 'audio')
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['reason'], 'whisper_unavailable')


if __name__ == '__main__':
    unittest.main()
