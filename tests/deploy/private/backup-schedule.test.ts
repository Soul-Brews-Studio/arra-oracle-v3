import { expect, test } from 'bun:test';

test('scheduled backup preserves restart guard, encryption and strict off-host transport', async () => {
  const backup = await Bun.file('deploy/private/arra-full-stack/scheduled-backup.sh').text();
  expect(backup.indexOf("trap 'docker")).toBeLessThan(backup.indexOf('stop --time 30'));
  expect(backup).toContain('flock -n 9');
  expect(backup).toContain('"$bundle/backup-age.sh"');
  expect(backup).not.toContain('tar -');
  const pull = await Bun.file('deploy/private/arra-full-stack/pull-backups-mac.sh').text();
  expect(pull).toContain('StrictHostKeyChecking=yes');
  expect(pull).toContain('UpdateHostKeys=no');
  expect(pull).not.toContain('--delete');
  expect(pull).toContain('shasum -a 256 -c');
});
