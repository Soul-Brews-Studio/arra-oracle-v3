"""Conservative volume classification; unknown providers remain coverage gaps."""
import json
import platform
import plistlib
import subprocess


def linux_roots(data):
    result, seen = [], set()
    def visit(items):
        for item in items:
            identity = item.get('uuid')
            local = (item.get('source', '').startswith('/dev/') and identity
                     and item.get('fstype') in {'ext4', 'ext3', 'xfs', 'btrfs', 'vfat', 'exfat', 'ntfs', 'ntfs3'})
            reason = 'local' if local else 'virtual_or_unverified'
            if local and (identity in seen or '[' in item['source']):
                reason = 'mount_alias'
            eligible = reason == 'local'
            if eligible:
                seen.add(identity)
            result.append({'root': item['target'], 'volume': identity,
                           'eligible': eligible, 'reason': reason})
            visit(item.get('children', []))
    visit(data['filesystems'])
    return result


def windows_roots(disks, partitions):
    letters = {p.get('DriveLetter') for p in partitions}
    result = []
    for disk in disks:
        root = disk['DeviceID']
        local = disk.get('DriveType') in (2, 3) and root.rstrip(':') in letters
        identity = disk.get('VolumeSerialNumber')
        result.append({'root': root + '\\', 'volume': identity,
                       'eligible': bool(local and identity),
                       'reason': 'local' if local and identity else 'unverified_provider'})
    return result


def command_json(args):
    return json.loads(subprocess.check_output(args, text=True, timeout=30))


def mac_roots(infos):
    result, seen = [], set()
    for info in infos:
        root, identity = info.get('MountPoint'), info.get('VolumeUUID')
        reason = 'local'
        if not root:
            reason = 'unmounted'
        elif root.startswith('/System/Volumes/') and root != '/System/Volumes/Data':
            reason = 'system_auxiliary'
        elif info.get('BusProtocol') not in {'Apple Fabric', 'PCI-Express', 'SATA', 'USB', 'Thunderbolt', 'FireWire'}:
            reason = 'virtual_or_unverified'
        elif not identity or identity in seen:
            reason = 'mount_alias'
        if reason == 'local':
            seen.add(identity)
        result.append({'root': root, 'volume': identity, 'eligible': reason == 'local', 'reason': reason})
    return result


def discover():
    system = platform.system()
    if system == 'Linux':
        return linux_roots(command_json(['findmnt', '-J', '-o', 'TARGET,SOURCE,FSTYPE,UUID']))
    if system == 'Windows':
        def powershell(query):
            result = command_json(['powershell', '-NoProfile', '-Command', query + ' | ConvertTo-Json -Compress'])
            return result if isinstance(result, list) else [result]
        return windows_roots(powershell('Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeSerialNumber'),
                             powershell('Get-Partition | Select-Object DriveLetter'))
    if system == 'Darwin':
        def plist(*args):
            return plistlib.loads(subprocess.check_output(['diskutil', *args], timeout=30))
        volumes = []
        for disk in plist('list', '-plist')['AllDisksAndPartitions']:
            volumes.extend(disk.get('APFSVolumes', []))
            volumes.extend(disk.get('Partitions', []))
        return mac_roots([plist('info', '-plist', v['DeviceIdentifier'])
                          for v in volumes if 'VolumeUUID' in v])
    raise RuntimeError('unsupported platform')


if __name__ == '__main__':
    print(json.dumps(discover()))
