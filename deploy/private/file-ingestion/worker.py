"""Network-disabled extraction worker; one JSON job in, one result out."""
import json
import os
from pathlib import Path
import sys
import tempfile

from extract import extract


def run(job_file, result_file):
    jobs = Path(job_file); results = Path(result_file)
    results.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with jobs.open(encoding='utf-8') as source, results.open('a', encoding='utf-8') as output:
        for line in source:
            try:
                job = json.loads(line); path = Path(job['path'])
                with tempfile.TemporaryDirectory(prefix='arra-worker-', dir='/tmp') as temp:
                    result = extract(path, temp)
                output.write(json.dumps({'job': job.get('id'), 'result': result}) + '\n'); output.flush()
            except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
                output.write(json.dumps({'job': job.get('id'), 'status': 'blocked', 'reason': type(error).__name__}) + '\n'); output.flush()


if __name__ == '__main__':
    run(os.environ.get('ARRA_FILES_JOBS', '/spool/jobs.jsonl'), os.environ.get('ARRA_FILES_RESULTS', '/spool/results.jsonl'))
