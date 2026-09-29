"""Read-only metadata walker. Caller must verify local volume type before use.

No body reads, network, output files, deletion reconciliation or automatic roots.
Records contain private paths: persist only to protected local collector state.
"""
import hashlib
import os
from pathlib import Path
import stat


SENSITIVE = {
    '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config',
    '.codex', '.hermes', '.claude', '.npmrc', '.pypirc', '.netrc',
    'credentials', 'credentials.json', 'secrets', 'keychains', 'login data',
    'cookies', 'web data', 'local state', 'auth.json', 'token.json',
    'tokens.json', 'passwords', 'bitwarden', '1password', 'keepass',
    'google', 'chromium', 'firefox', 'microsoft edge', 'brave-browser',
    'safari', 'thunderbird', 'outlook',
    '.git-credentials', '.gemini', '.pi', 'service-account.json', 'oauth.json',
    'key4.db', 'key3.db', 'logins.json', 'wallet.dat', 'shadow', 'gshadow',
    'security', 'sam', 'protect', 'vault', 'credential manager',
}


def sensitive(name):
    name = name.casefold()
    return (name in SENSITIVE or name.startswith(('.env', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'))
            or name.endswith(('.key', '.pem', '.p12', '.pfx', '.kdbx')))


def scan(root, device, volume, exclusions=(), max_depth=128):
    """Yield metadata and one completion record; false completion forbids deletion.

    Stable source identity is device + verified volume identity + filesystem inode.
    Separate path records retain hard-link locations. Format remains undetected
    until a later, secret-screened content stage inspects magic bytes.
    """
    root = Path(os.path.abspath(root))
    excluded = {os.path.abspath(p) for p in exclusions}
    excluded.add('/Users/poramateake/Developer/42')
    excluded.add('/System/Volumes/Data/Users/poramateake/Developer/42')
    complete = True
    count = 0
    stack = [iter([root])]
    try:
        root_stat = root.lstat()
        root_device = root_stat.st_dev
    except OSError:
        yield {'path': '.', 'status': 'unreadable'}
        yield {'complete': False, 'records': 1}
        return
    while stack:
        try:
            path = Path(next(stack[-1]))
        except StopIteration:
            stack.pop()
            continue
        except OSError:
            stack.pop()
            complete = False
            count += 1
            yield {'status': 'unreadable_directory', 'device': device, 'volume': volume,
                   'path': str(path.relative_to(root))}
            continue
        record = {'device': device, 'volume': volume,
                  'path': str(path.relative_to(root))}
        descend = False
        try:
            info = path.lstat()
            attrs = getattr(info, 'st_file_attributes', 0)
            if any(str(parent) in excluded for parent in (path, *path.parents)):
                record['status'] = 'excluded_policy'
            elif any(sensitive(part) for part in path.parts):
                record['status'] = 'excluded_sensitive'
            elif stat.S_ISLNK(info.st_mode) or attrs & 0x400:
                record['status'] = 'excluded_link'
            elif (attrs & (0x1000 | 0x40000 | 0x400000)
                  or getattr(info, 'st_flags', 0) & 0x40000000):
                record['status'] = 'cloud_only'
                complete = False
            elif info.st_dev != root_device:
                record['status'] = 'separate_volume'
                complete = False
            elif stat.S_ISDIR(info.st_mode):
                descend = True
            elif stat.S_ISREG(info.st_mode):
                identity = f'{device}\0{volume}\0{info.st_ino}'
                record.update(status='discovered', size=info.st_size,
                              mtime_ns=info.st_mtime_ns, format='undetected',
                              source_id=hashlib.sha256(identity.encode()).hexdigest())
            else:
                record['status'] = 'excluded_special'
            if descend:
                if len(stack) >= max_depth:
                    record['status'] = 'depth_limit'
                    complete = False
                else:
                    stack.append(children(path))
                    continue
        except OSError:
            record['status'] = 'unreadable'
            complete = False
        count += 1
        yield record
    yield {'complete': complete, 'records': count}


def children(path):
    """Keep one iterator per depth, never materialize directory-sized lists."""
    with os.scandir(path) as entries:
        for entry in entries:
            yield entry.path
