import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'deploy/private/file-ingestion'))
from volumes import linux_roots, windows_roots, mac_roots


class VolumeTest(unittest.TestCase):
    def test_mac_disk_images_and_system_auxiliary_volumes_are_not_ingested(self):
        records = mac_roots([
            {'MountPoint': '/System/Volumes/Data', 'VolumeUUID': 'a', 'BusProtocol': 'Apple Fabric'},
            {'MountPoint': '/Volumes/Installer', 'VolumeUUID': 'b', 'BusProtocol': 'Disk Image'},
            {'MountPoint': '/System/Volumes/VM', 'VolumeUUID': 'c', 'BusProtocol': 'Apple Fabric'},
            {'VolumeUUID': 'd', 'BusProtocol': 'USB'},
        ])
        self.assertTrue(records[0]['eligible'])
        self.assertFalse(records[1]['eligible'])
        self.assertFalse(records[2]['eligible'])
        self.assertEqual(records[3]['reason'], 'unmounted')

    def test_linux_virtual_mounts_and_duplicate_uuid_are_not_roots(self):
        data = {'filesystems': [
            {'target': '/', 'source': '/dev/sda1', 'fstype': 'ext4', 'uuid': 'a',
             'children': [
                 {'target': '/proc', 'source': 'proc', 'fstype': 'proc'},
                 {'target': '/alias', 'source': '/dev/sda1[/home]', 'fstype': 'ext4', 'uuid': 'a'},
                 {'target': '/media/b', 'source': '/dev/sdb1', 'fstype': 'ext4', 'uuid': 'b'}]}]}
        records = linux_roots(data)
        self.assertEqual([r['root'] for r in records if r['eligible']], ['/', '/media/b'])
        self.assertEqual(records[2]['reason'], 'mount_alias')

    def test_windows_fixed_letter_without_partition_is_not_assumed_local(self):
        records = windows_roots([
            {'DeviceID': 'C:', 'DriveType': 3, 'VolumeSerialNumber': 'a'},
            {'DeviceID': 'G:', 'DriveType': 3, 'VolumeSerialNumber': 'b'},
            {'DeviceID': 'Z:', 'DriveType': 4, 'VolumeSerialNumber': 'c'},
        ], [{'DriveLetter': 'C'}])
        self.assertTrue(records[0]['eligible'])
        self.assertFalse(records[1]['eligible'])
        self.assertEqual(records[1]['reason'], 'unverified_provider')
        self.assertFalse(records[2]['eligible'])


if __name__ == '__main__':
    unittest.main()
